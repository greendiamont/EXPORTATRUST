import type { ReactNode } from "react";

export default function Template({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`.operation-overview > .operation-task-board { order: 999; }`}</style>
      {children}
    </>
  );
}
