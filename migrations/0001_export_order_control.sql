CREATE TABLE IF NOT EXISTS export_control_settings (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id integer DEFAULT 1 NOT NULL,
  operation_id integer NOT NULL UNIQUE,
  customer_name text DEFAULT '' NOT NULL,
  customer_email text DEFAULT '' NOT NULL,
  customer_reference text DEFAULT '' NOT NULL,
  notifications_enabled integer DEFAULT 1 NOT NULL,
  tracking_interval_days integer DEFAULT 10 NOT NULL,
  next_tracking_at text,
  email_provider_status text DEFAULT 'Simulação' NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);
CREATE TABLE IF NOT EXISTS export_milestones (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id integer DEFAULT 1 NOT NULL,
  operation_id integer NOT NULL,
  code text NOT NULL,
  sequence integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  status text DEFAULT 'Pendente' NOT NULL,
  quality_status text DEFAULT 'Não iniciado' NOT NULL,
  shipment_approval text DEFAULT 'Não aplicável' NOT NULL,
  due_date text DEFAULT '' NOT NULL,
  note text DEFAULT '' NOT NULL,
  completed_at text,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id),
  UNIQUE(operation_id, code)
);
CREATE TABLE IF NOT EXISTS client_notifications (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id integer DEFAULT 1 NOT NULL,
  operation_id integer NOT NULL,
  milestone_code text DEFAULT '' NOT NULL,
  recipient text DEFAULT '' NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text DEFAULT 'Rascunho' NOT NULL,
  provider text DEFAULT 'simulation' NOT NULL,
  external_id text DEFAULT '' NOT NULL,
  error text DEFAULT '' NOT NULL,
  sent_at text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id integer DEFAULT 1 NOT NULL,
  operation_id integer NOT NULL,
  source text DEFAULT 'manual' NOT NULL,
  status text NOT NULL,
  location text DEFAULT '' NOT NULL,
  eta text DEFAULT '' NOT NULL,
  details text DEFAULT '' NOT NULL,
  checked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  next_check_at text DEFAULT '' NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);
CREATE TABLE IF NOT EXISTS country_compliance_checks (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  organization_id integer DEFAULT 1 NOT NULL,
  operation_id integer NOT NULL,
  country text NOT NULL,
  hs_code text NOT NULL,
  score integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'Pendente' NOT NULL,
  result_json text DEFAULT '[]' NOT NULL,
  checked_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);
