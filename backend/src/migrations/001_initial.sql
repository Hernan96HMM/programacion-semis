-- Resources
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  active BOOLEAN NOT NULL DEFAULT true,
  absences JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resource groups
CREATE TABLE IF NOT EXISTS resource_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  members JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operations catalog (autocomplete list, no relational meaning)
CREATE TABLE IF NOT EXISTS operations (
  name TEXT PRIMARY KEY
);

-- Sequences (production templates per product model)
CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ops JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendar (singleton row)
CREATE TABLE IF NOT EXISTS calendar (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  work_days JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
  hours_per_day INTEGER NOT NULL DEFAULT 8,
  holidays JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO calendar (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Simulation params (singleton row)
CREATE TABLE IF NOT EXISTS sim_params (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  lead_oc INTEGER NOT NULL DEFAULT 0,
  lead_eng INTEGER NOT NULL DEFAULT 0,
  eng_cap INTEGER NOT NULL DEFAULT 1,
  target_ueq NUMERIC(8,3) NOT NULL DEFAULT 6,
  model_leads JSONB NOT NULL DEFAULT '[]',
  model_ueq JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO sim_params (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Orders (OT / pedidos de fabricación)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_num TEXT NOT NULL,
  unit_num INTEGER NOT NULL,
  pe_inicial DATE,
  client TEXT NOT NULL,
  product_type TEXT,
  progress NUMERIC(6,4) NOT NULL DEFAULT 0,
  status TEXT,
  due_date DATE,
  notes TEXT,
  gantt_weeks JSONB NOT NULL DEFAULT '{}',
  updated_at DATE,
  is_sim BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER,
  seq_id TEXT,
  u_eq NUMERIC(8,3),
  sim_lead_oc INTEGER,
  sim_lead_eng INTEGER,
  planned_start DATE,
  op_days JSONB,
  op_resources JSONB,
  op_progress JSONB,
  op_preds JSONB,
  op_extra JSONB,
  op_order JSONB,
  op_skip JSONB,
  op_manual_starts JSONB,
  scheduled_ops JSONB NOT NULL DEFAULT '[]',
  start_date DATE,
  end_date DATE,
  sim_base_date DATE,
  oc_end DATE,
  eng_start DATE,
  eng_end DATE,
  sim_base_ot TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders(priority);
CREATE INDEX IF NOT EXISTS idx_orders_seq ON orders(seq_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
