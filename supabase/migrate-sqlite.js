require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.INITIAL_ADMIN_USERNAME) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and INITIAL_ADMIN_USERNAME are required');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sqlitePath = path.join(__dirname, '..', 'data', 'timesheet.sqlite');
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found: ${sqlitePath}`);
const sqlite = new DatabaseSync(sqlitePath);
const row = sqlite.prepare('SELECT payload FROM app_state WHERE id = 1').get();
if (!row) throw new Error('No SQLite app_state row found');
const state = JSON.parse(row.payload);

async function run() {
  const { data: admin, error: adminError } = await supabase.from('users').select('id').eq('username', process.env.INITIAL_ADMIN_USERNAME).single();
  if (adminError) throw adminError;
  const mappings = {
    projects: { endUser: 'end_user', pmHours: 'pm_hours', seniorHours: 'senior_hours', engineerHours: 'engineer_hours' },
    engineers: { employeeId: 'employee_id', subSystem: 'sub_system' },
    holidays: {}
  };
  const convert = (table, item) => {
    const result = { ...item };
    Object.entries(mappings[table]).forEach(([from, to]) => { if (from in result) { result[to] = result[from]; delete result[from]; } });
    return result;
  };
  for (const table of ['projects', 'engineers', 'holidays']) {
    const values = (state[table] || []).map(item => convert(table, item));
    if (values.length) {
      const { error } = await supabase.from(table).upsert(values, { onConflict: 'id' });
      if (error) throw error;
    }
  }
  const entries = (state.entries || []).map(item => {
    const result = { ...item, created_by_user_id: admin.id };
    Object.assign(result, { engineer_id: result.engineerId, project_id: result.projectId, work_date: result.date, start_time: result.start, end_time: result.end, stay_hotel: result.stayHotel });
    delete result.owner_id; delete result.engineerId; delete result.projectId; delete result.date; delete result.start; delete result.end; delete result.stayHotel;
    return result;
  });
  if (entries.length) {
    const { error } = await supabase.from('timesheet_entries').upsert(entries, { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`Migrated ${state.projects?.length || 0} projects, ${state.engineers?.length || 0} engineers, ${entries.length} entries and ${state.holidays?.length || 0} holidays.`);
}
run().catch(error => { console.error('SQLite migration failed:', error.message); process.exitCode = 1; });
