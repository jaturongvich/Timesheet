# Timesheet Record - Release 1

**Release:** 1.0.0  
**Application type:** Node.js web application backed by Supabase  
**Runtime:** Node.js 24 or newer  
**Storage:** Supabase Postgres (relational tables)  
**Default address:** <http://localhost:3000>  
**Project location:** `C:\Projects\Timesheet`

## 1. Release overview

Release 1 is a local timesheet tracking application for recording project work, managing engineers and roles, calculating normal and overtime hours, reviewing reports, and summarizing project activity on an Overview dashboard.

The application uses Supabase Postgres and server-side username/password sessions. Configure the server with `.env` (copy `.env.example`); never expose the service-role key to browser code.

### GitHub-connected Netlify deployment

1. Commit this project to a GitHub repository and create a Netlify site using **Import an existing project → GitHub**.
2. Keep the repository build settings at their defaults; `netlify.toml` publishes `public` and routes `/api/*` to the `api` Netlify Function.
3. In Netlify site settings, add these environment variables for the deployed Functions:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never add it to frontend code)
   - `SESSION_SECRET` (long random value)
   - `INITIAL_ADMIN_USERNAME`
   - `INITIAL_ADMIN_PASSWORD`
4. Deploy from the connected GitHub branch. Netlify automatically rebuilds and redeploys on pushes.
5. Apply `supabase/schema.sql` only if the existing schema is not already present. It is non-destructive and uses `public.timesheet_entries`.

For local development, `npm start` remains available. `npm run start:netlify` requires the Netlify CLI and runs the same function routes locally.

Run `supabase/schema.sql` in the Supabase SQL editor before starting the server. It is non-destructive and matches the already-established `timesheet_entries` table and snake_case columns. If that schema has already been run, do not create a second `entries` table. Set `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` to bootstrap the first administrator. Additional users may register through `POST /api/auth/register`; login creates an HttpOnly session cookie. Administrators manage projects, resources, and holidays, while timesheet entries are owned by their creating user (administrators can review all entries).

To preserve an existing Release 1 SQLite data file, run `npm run migrate` after the schema and initial admin have been created. The migration assigns imported entries to the initial administrator and is safe to repeat by ID.

The application currently contains these navigation pages:

1. **Overview**
2. **Projects**
3. **Resources**
4. **Check in**
5. **Reports**
6. **Holidays**

The previous **Uploads** page and upload API were removed from the active application in this release.

## 2. Main capabilities

### 2.1 Overview dashboard

The Overview page provides a project-focused summary of recorded timesheet data.

#### Project selection

- A project dropdown is shown at the top of the page.
- Projects are displayed using their project code and project name.
- The first project in the project list is selected by default.
- Changing the project recalculates all dashboard values.

#### Summary period selection

- The Summary period control supports:
  - All periods
  - One month
  - Multiple months
- Periods are displayed as `MM/YYYY`.
- Selecting periods recalculates all Overview content:
  - KPI cards
  - Hours by role
  - Member summary
  - Hours by sub systems
- An empty period selection means all available periods.

#### KPI cards

The dashboard includes:

- Total logged hours
- Normal hours
- Overtime
- Hotel
- Traveling Distance
- Traveling Hours
- Active project indicator

The KPI values use only records matching the selected project and selected period.

#### Hours by role chart

The role donut chart summarizes working hours by:

- Engineer
- Senior Engineer
- Project manager

The chart uses the `worked` hours from filtered timesheet records.

#### Hours by sub systems chart

The subsystem donut chart summarizes working hours by the subsystem assigned to the engineer.

- The calculation uses the same project and period filter as the rest of the dashboard.
- Each engineer's `subSystem` value is used as the grouping key.
- Blank subsystem values are grouped under **Unassigned**.
- The chart legend displays the total hours for each subsystem.

#### Member summary table

The Member summary table shows engineers who have matching timesheet records for the selected project and period.

Columns:

| Column | Description |
|---|---|
| Name Surname | Engineer name from the Resources page |
| Normal hours | Total calculated normal hours |
| OT | Total standard overtime hours |
| Premium OT | Total premium overtime hours |
| Hotel | Number of hotel records |
| Travel hours | Total travel time |
| Travel distance | Total travel mileage in kilometers |

## 3. Projects page

The Projects page manages the project register.

### Project fields

- Project code
- Project name
- Customer name
- End user name
- Description
- Project manager capacity in hours
- Senior engineer capacity in hours
- Engineer capacity in hours

### Project operations

- Add a new project.
- Edit an existing project.
- Delete a project.
- Filter projects by code, name, or customer.

Project records are stored in the Supabase `projects` table.

## 4. Resources page

The Resources page manages engineers and other timesheet resources.

### Resource fields

- Employee ID
- Name
- Surname
- Role
- Sub Systems

Available roles in the current interface:

- Engineer
- Senior Engineer
- Project manager

### Resources table

The table columns are ordered as:

1. Role
2. Sub Systems
3. Name
4. Surname
5. Actions

### Sub Systems field

- The field is available when creating and editing a resource.
- A browser autocomplete list provides previously saved subsystem values.
- Users can select an existing suggestion or enter a new text value.
- Existing subsystem values are collected from saved resources.

### Resource operations

- Add a new resource.
- Edit a saved resource.
- Delete a resource.
- Filter by role, subsystem, or name.

Timesheet entries store the engineer ID. Therefore, changing an engineer's name or surname automatically changes the engineer name shown in Reports and Overview.

## 5. Check in page

The Check in page is used to create timesheet records.

### Entry fields

- Engineer
- Project
- Date
- Time in
- Time out
- Lunch / dinner
- Normal hours expected
- Travel time
- Travel mileage
- Hotel
- Activities

### Default times

- Default start time: `08:00`
- Default end time: `17:00`
- Default expected normal hours: `8`

### Calculation behavior

Worked hours are calculated as:

```text
worked hours = time out - time in - lunch
```

Worked hours cannot be less than zero.

For a normal weekday:

```text
normal hours = minimum(worked hours, expected hours)
OT = maximum(worked hours - expected hours, 0)
premium OT = 0
```

For a weekend or holiday:

```text
normal hours = 0
OT = minimum(worked hours, expected hours)
premium OT = maximum(worked hours - expected hours, 0)
```

Calculated values are stored with the entry and recalculated when an entry is created or edited.

## 6. Holidays page

The Holidays page manages holiday dates used in timesheet calculations.

### Holiday fields

- Date
- Description

### Holiday behavior

- A date registered as a holiday is treated as a holiday instead of a normal weekday.
- Holiday records are used by the calculation engine.
- Adding or deleting a holiday triggers recalculation of existing entries.
- Holiday dates are highlighted in Reports.

Weekend dates are detected automatically from Saturday and Sunday.

## 7. Reports page

The Reports page displays saved timesheet records.

### Report columns

The report table is ordered as:

1. Selection checkbox
2. Date
3. Day type
4. Engineer
5. Project
6. Time in
7. Time out
8. Lunch
9. Work hours
10. Normal
11. OT
12. Premium OT
13. Travel Time
14. Travel mileage
15. Hotel
16. Activities
17. Actions

### Display behavior

- Records are shown newest date first.
- Maximum 50 records are displayed per page.
- Previous and Next controls appear when more than 50 records match the current filters.
- The report uses the available monitor width.
- Weekend rows have a different background.
- Holiday rows have a different holiday background.
- OT values greater than zero are bold and red.
- Premium OT values greater than zero are bold and red.

### Filters

Reports can be filtered by:

- From date
- To date
- Engineer name
- Project code

### Individual actions

Each row provides:

- Edit
- Delete

Individual editing supports changing the complete timesheet record, including engineer, project, date, time values, travel values, hotel, and activities.

### Bulk selection

- Each row begins with a selection checkbox.
- The header checkbox selects or clears all visible records on the current page.
- Selection state is retained while moving between report pages.
- The current page can be selected independently from other pages.

### Bulk editing

The **Edit Select** button opens a mode selection dialog.

#### Edit Project

- Updates only the project of selected records.
- Date, time, engineer, travel values, hotel, and activities remain unchanged.
- Calculated hour values are recalculated after the project update.

#### Edit Engineer

- Updates only the engineer of selected records.
- Project and all timesheet values remain unchanged.
- The selected engineer is used in future Reports and Overview summaries.

### Bulk deletion

The **Delete Select** button:

1. Checks that at least one record is selected.
2. Opens a confirmation dialog.
3. Deletes all selected records after confirmation.
4. Clears the selection and refreshes the report.

### CSV export

- Export uses the current report filters.
- Export order is oldest date first.
- The on-screen report remains newest first.
- CSV columns include date, day type, engineer, project, times, calculated hours, travel, hotel, and activities.

The current Import CSV control is only a placeholder that selects a file and displays a message. It does not currently import rows into the database.

## 8. Data storage

Release 1 uses Supabase Postgres through the server-only service-role client. The server maps the API's existing camelCase names to the established snake_case schema:

| API concept | Supabase table/columns |
|---|---|
| Projects | `projects`, including `end_user`, `pm_hours`, `senior_hours`, `engineer_hours` |
| Engineers | `engineers`, including `employee_id`, `sub_system` |
| Entries | `timesheet_entries`, including `created_by_user_id`, `engineer_id`, `project_id`, `work_date`, `start_time`, `end_time`, `stay_hotel` |
| Holidays | `holidays` |

RLS may remain enabled. All database calls are made on the server using the service-role key, which is never sent to the browser. The browser continues to receive the original API state shape, so frontend behavior is preserved.

The old `uploads` property is removed from loaded state by the server. The Uploads page and upload endpoints are no longer part of the active release.

## 9. API endpoints

The Node server exposes the following local JSON endpoints.

### Application state

```http
GET /api/state
```

Returns the current projects, engineers, entries, and holidays.

### Projects

```http
POST   /api/projects
PUT    /api/projects/:id
DELETE /api/projects/:id
```

Project creation requires:

- `code`
- `name`
- `customer`

### Engineers

```http
POST   /api/engineers
PUT    /api/engineers/:id
DELETE /api/engineers/:id
```

Engineer creation requires:

- `name`
- `surname`

Optional engineer values include:

- `employeeId`
- `role`
- `subSystem`

### Timesheet entries

```http
POST   /api/entries
PUT    /api/entries/:id
DELETE /api/entries/:id
```

Entry creation requires:

- `engineerId`
- `projectId`
- `date`

The server calculates:

- `worked`
- `normal`
- `ot`
- `premium`
- `dayType`

### Holidays

```http
POST   /api/holidays
DELETE /api/holidays/:id
```

Holiday creation requires:

- `date`
- `description`

### Recalculation

```http
POST /api/refresh
```

Recalculates all saved entries using the current holiday list and calculation rules.

## 10. Installation and startup

### Requirements

- Windows
- Node.js 24 or newer
- A modern browser
- Write access to `C:\Projects\Timesheet`

No external npm package installation is required for the current implementation.

### Start with Node.js

Open PowerShell:

```powershell
cd C:\Projects\Timesheet
node server.js
```

Open the application:

```text
http://localhost:3000
```

Keep the PowerShell window open while using the application.

### Start with npm

```powershell
cd C:\Projects\Timesheet
npm.cmd start
```

### Start with the batch file

Double-click:

```text
C:\Projects\Timesheet\start-timesheet.bat
```

The batch file runs:

```bat
cd /d C:\Projects\Timesheet
node server.js
pause
```

## 11. Stopping the application

### Normal stop

If the application is running in a PowerShell or Command Prompt window, press:

```text
Ctrl + C
```

### Batch file stop

Press `Ctrl + C` in the batch window, or close the window after confirming that the service should stop.

Supabase manages database backups. Keep `.env` and the service-role key out of source control.

## 12. Backup and restore

### Current Release 1 backup

A verified local backup was created as:

```text
C:\Projects\Timesheet-backup-20260921-221234.zip
```

### Manual backup using PowerShell

Stop the service first, then run:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = "C:\Projects\Timesheet-backup-$stamp.zip"
Compress-Archive `
  -Path C:\Projects\Timesheet\data,C:\Projects\Timesheet\public,C:\Projects\Timesheet\uploads,C:\Projects\Timesheet\package.json,C:\Projects\Timesheet\server.js,C:\Projects\Timesheet\start-timesheet.bat `
  -DestinationPath $archive `
  -CompressionLevel Optimal
Write-Output $archive
```

### Restore procedure

1. Stop the Node service.
2. Keep a copy of the current project folder if it contains newer data.
3. Extract the backup ZIP to a temporary folder.
4. Copy the extracted files into `C:\Projects\Timesheet`.
5. Confirm that `data\timesheet.sqlite` is present.
6. Start the service again.
7. Open `http://localhost:3000`.
8. Check Projects, Resources, Reports, and Overview.

Do not overwrite a newer database with an older backup unless that is intentional.

## 13. Testing and verification completed

The following checks were completed during Release 1 development:

- Node.js syntax check for `server.js`.
- Node.js syntax check for `public\app.js`.
- Local HTTP/API smoke test.
- SQLite-backed state loading.
- Project creation and editing.
- Engineer creation and editing.
- Engineer name propagation to Reports.
- Subsystem creation, editing, filtering, and suggestions.
- Check in default end time verification.
- Normal, overtime, and premium overtime calculation checks.
- Weekend and holiday handling.
- Reports newest-first display.
- CSV oldest-first export.
- Reports pagination at 50 records per page.
- Individual report editing and deletion.
- Report bulk selection across multiple pages.
- Bulk project editing.
- Bulk engineer editing.
- Bulk deletion confirmation.
- Overview project filtering.
- Overview multiple-period filtering.
- Overview KPI recalculation.
- Hours by role chart recalculation.
- Hours by sub systems chart recalculation.
- Member summary table recalculation.
- Backup archive creation and ZIP content verification.

## 14. Current data snapshot

At the time of this Release 1 documentation:

- Project `TH-Y1001` exists.
- Project name is `CFP Project`.
- Imported timesheet data is stored in the local SQLite database.
- Engineer resources and timesheet entries are stored locally.
- The database includes subsystem values used by the Overview subsystem chart.

The database may also contain the temporary engineer record `test1 test1` from earlier verification. Review the Resources page before production use and delete it if it is not intended.

## 15. Known limitations

Release 1 intentionally remains a simple local application.

### Authentication and authorization

- Username/password registration and login are available.
- Administrators manage shared reference data.
- Timesheet entries are restricted to their owner unless viewed by an administrator.

### Deployment

- The server listens on the local machine.
- The application is not configured as a production internet service.
- Supabase supports shared multi-user storage; deploy the Node server behind HTTPS for network use.

### Legacy SQLite migration

- The migration command is retained for importing an older JSON state file.
- It does not delete existing Supabase rows and maps legacy camelCase fields to the established snake_case schema.

### CSV import

- The Import CSV control is not a completed import workflow.
- It currently selects a CSV file and displays an informational message.
- Data must be entered through Check in or existing application APIs.

### Delete behavior

- Deleting a project or engineer does not currently provide database-level foreign-key protection.
- Review related records before deleting production data.
- Make a backup before large deletes or bulk changes.

### Browser and service lifecycle

- The Node process must remain running while the browser is in use.
- `npm run migrate` imports the legacy SQLite payload into the existing Supabase tables without deleting data.
- Stop the service before backup or restore.

## 16. Important files

| File or folder | Purpose |
|---|---|
| `server.js` | Node HTTP server, Supabase mapping, authentication, calculations, and API endpoints |
| `public\index.html` | Application shell and navigation |
| `public\app.js` | Frontend pages, forms, charts, filters, reports, and interactions |
| `public\styles.css` | Layout, responsive styling, tables, cards, charts, and report highlighting |
| `supabase\schema.sql` | Non-destructive Supabase schema reference |
| `package.json` | Project metadata and start/test scripts |
| `start-timesheet.bat` | Windows convenience startup script |
| `uploads\` | Legacy local folder retained in the project folder; active Uploads feature is removed |
| `RELEASE1.md` | This Release 1 documentation |

## 17. Release 1 acceptance summary

Release 1 is suitable for local timesheet recording and review when:

- The Node service is started locally.
- The Supabase schema has been applied.
- Environment variables are configured and the service-role key remains server-only.
- Supabase backups or exports are configured as appropriate.
- The temporary test engineer record is reviewed and removed if necessary.
- Users understand that authentication and network deployment are not included.
