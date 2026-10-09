#!/usr/bin/env python3
import argparse
import json
import os
import sys
import tarfile
import tempfile
from pathlib import Path

import boto3
from botocore.config import Config

EXPECTED_OBJECTS = 451
EXPECTED_BYTES = 155_513_309
EXPECTED_FORMAT = "ExportaTrust Full R2 Export v1"


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def parse_args():
    p = argparse.ArgumentParser(description="ExportaTrust Phase 5 R2 migration")
    p.add_argument("--tar", required=True)
    p.add_argument("--bucket", required=True)
    p.add_argument("--endpoint", required=True)
    p.add_argument("--report", default="phase5-r2-report.json")
    return p.parse_args()


def load_manifest(tf):
    try:
        member = tf.getmember("exportatrust-r2-manifest.json")
    except KeyError:
        fail("Manifest exportatrust-r2-manifest.json not found in TAR")
    src = tf.extractfile(member)
    if not src:
        fail("Manifest could not be read")
    manifest = json.load(src)
    if manifest.get("format") != EXPECTED_FORMAT:
        fail(f"Unexpected manifest format: {manifest.get('format')!r}")
    objects = manifest.get("objects")
    if not isinstance(objects, list):
        fail("Manifest objects must be an array")
    if manifest.get("objectCount") != EXPECTED_OBJECTS:
        fail(f"Expected {EXPECTED_OBJECTS} objects, got {manifest.get('objectCount')}")
    if manifest.get("totalBytes") != EXPECTED_BYTES:
        fail(f"Expected {EXPECTED_BYTES} bytes, got {manifest.get('totalBytes')}")
    return manifest


def validate_tar(tf, manifest):
    members = {m.name: m for m in tf.getmembers() if m.isfile()}
    missing = []
    size_mismatches = []
    total = 0
    for item in manifest["objects"]:
        path = item["archivePath"]
        member = members.get(path)
        if member is None:
            missing.append(path)
            continue
        if member.size != int(item["size"]):
            size_mismatches.append({"archivePath": path, "expected": item["size"], "actual": member.size})
        total += member.size

    object_members = [m for n, m in members.items() if n.startswith("objects/")]
    result = {
        "objectCount": manifest["objectCount"],
        "filesFound": len(object_members),
        "totalBytes": manifest["totalBytes"],
        "bytesFound": total,
        "missing": missing,
        "sizeMismatches": size_mismatches,
    }
    ok = (
        not missing
        and not size_mismatches
        and len(object_members) == manifest["objectCount"]
        and total == manifest["totalBytes"]
    )
    if not ok:
        print(json.dumps({"ok": False, "stage": "validate-tar", **result}, indent=2))
        raise SystemExit(2)
    print(json.dumps({"ok": True, "stage": "validate-tar", **result}, indent=2))


def make_s3(endpoint):
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 10, "mode": "standard"}),
    )


def head_size(s3, bucket, key):
    try:
        return int(s3.head_object(Bucket=bucket, Key=key)["ContentLength"])
    except s3.exceptions.ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def upload_objects(tf, manifest, s3, bucket):
    uploaded = 0
    skipped = 0
    failed = []
    for idx, item in enumerate(manifest["objects"], start=1):
        key = item["key"]
        expected = int(item["size"])
        current = head_size(s3, bucket, key)
        if current == expected:
            skipped += 1
            print(f"[{idx}/{manifest['objectCount']}] SKIP {key}")
            continue

        member = tf.getmember(item["archivePath"])
        src = tf.extractfile(member)
        if not src:
            failed.append({"key": key, "error": "archive member unreadable"})
            continue

        extra = {}
        http_meta = item.get("httpMetadata") or {}
        custom_meta = item.get("customMetadata") or {}
        if http_meta.get("contentType"):
            extra["ContentType"] = http_meta["contentType"]
        if http_meta.get("contentDisposition"):
            extra["ContentDisposition"] = http_meta["contentDisposition"]
        if http_meta.get("contentEncoding"):
            extra["ContentEncoding"] = http_meta["contentEncoding"]
        if http_meta.get("contentLanguage"):
            extra["ContentLanguage"] = http_meta["contentLanguage"]
        if http_meta.get("cacheControl"):
            extra["CacheControl"] = http_meta["cacheControl"]
        if custom_meta:
            extra["Metadata"] = {str(k): str(v) for k, v in custom_meta.items()}

        try:
            s3.upload_fileobj(src, bucket, key, ExtraArgs=extra or None)
            actual = head_size(s3, bucket, key)
            if actual != expected:
                failed.append({"key": key, "expected": expected, "actual": actual})
            else:
                uploaded += 1
                print(f"[{idx}/{manifest['objectCount']}] UPLOAD {key}")
        except Exception as exc:
            failed.append({"key": key, "error": str(exc)})

    if failed:
        print(json.dumps({"ok": False, "stage": "upload", "uploaded": uploaded, "skipped": skipped, "failed": failed[:50]}, indent=2))
        raise SystemExit(3)
    print(json.dumps({"ok": True, "stage": "upload", "uploaded": uploaded, "skipped": skipped, "total": manifest["objectCount"]}, indent=2))


def list_destination(s3, bucket):
    rows = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for item in page.get("Contents", []):
            rows.append({"key": item["Key"], "size": int(item["Size"])})
    return rows


def validate_destination(manifest, actual):
    actual_map = {row["key"]: row for row in actual}
    expected_map = {row["key"]: row for row in manifest["objects"]}
    missing = []
    size_mismatches = []

    for key, expected in expected_map.items():
        got = actual_map.get(key)
        if got is None:
            missing.append({"key": key, "expectedSize": int(expected["size"])})
        elif got["size"] != int(expected["size"]):
            size_mismatches.append({"key": key, "expected": int(expected["size"]), "actual": got["size"]})

    extras = [row for key, row in actual_map.items() if key not in expected_map]
    actual_bytes = sum(row["size"] for row in actual)
    expected_bytes = sum(int(row["size"]) for row in manifest["objects"])
    report = {
        "ok": (
            not missing
            and not size_mismatches
            and not extras
            and len(actual) == manifest["objectCount"]
            and actual_bytes == expected_bytes
        ),
        "mode": "validate-r2",
        "expectedObjectCount": manifest["objectCount"],
        "actualObjectCount": len(actual),
        "expectedTotalBytes": expected_bytes,
        "actualTotalBytes": actual_bytes,
        "missing": missing,
        "sizeMismatches": size_mismatches,
        "extras": extras,
    }
    return report


def main():
    args = parse_args()
    tar_path = Path(args.tar)
    if not tar_path.is_file():
        fail(f"TAR not found: {tar_path}")

    with tarfile.open(tar_path, "r:") as tf:
        manifest = load_manifest(tf)
        validate_tar(tf, manifest)
        s3 = make_s3(args.endpoint)
        upload_objects(tf, manifest, s3, args.bucket)
        actual = list_destination(s3, args.bucket)
        report = validate_destination(manifest, actual)

    Path(args.report).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit(4)


if __name__ == "__main__":
    main()
