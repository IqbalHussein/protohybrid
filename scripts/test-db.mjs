// Tests supabase/migrations/0003_full_app.sql and 0004_plan_builder.sql against a replica of the live
// schema in PGlite (in-process Postgres). Run: node scripts/test-db.mjs
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const SQUAT = "11111111-0000-0000-0000-000000000001";
const BENCH = "11111111-0000-0000-0000-000000000002";
const B_CUSTOM = "11111111-0000-0000-0000-0000000000b1";

const db = new PGlite();
let failures = 0;
let passes = 0;

function check(cond, msg) {
  if (cond) passes++;
  else {
    failures++;
    console.error("FAIL:", msg);
  }
}

async function as(user) {
  await db.exec("reset role");
  if (user === "anon") {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false)");
  } else if (user) {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
  } else {
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

async function expectError(sql, params, fragment, msg) {
  try {
    await db.query(sql, params);
    check(false, `${msg}: expected error containing "${fragment}"`);
  } catch (e) {
    check(String(e.message).includes(fragment), `${msg}: got "${e.message}"`);
  }
}

// ---- Arrange: live schema + data shaped like production -------------------
await db.exec(read("supabase/tests/live_schema.sql"));
await db.exec(`
  insert into auth.users values ('${A}'), ('${B}');
  insert into exercises (id, name, muscle_group) values
    ('${SQUAT}', 'Barbell Squat', 'quadriceps'), ('${BENCH}', 'Bench Press', 'chest');
  insert into exercises (id, name, is_custom, user_id) values ('${B_CUSTOM}', 'B secret lift', true, '${B}');
  insert into plans (id, user_id, week_start_date) values
    ('22222222-0000-0000-0000-000000000001', '${A}', '2026-10-26');
  insert into sessions (id, plan_id, type, planned_date, status) values
    ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'run', '2026-10-27', 'completed'),
    ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'run', '2026-10-28', 'completed'),
    ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'lift', '2026-10-29', 'completed');
  insert into run_details (session_id, run_type, actual_distance_km, strava_name, notes) values
    ('33333333-0000-0000-0000-000000000001', 'easy', 5, 'Morning Run', 'felt good'),
    ('33333333-0000-0000-0000-000000000002', 'tempo', 8, 'Evening Run', null);
  insert into lift_details (session_id, focus) values ('33333333-0000-0000-0000-000000000003', 'legs');
  insert into lift_sets (lift_details_id, set_number, reps, weight, exercise_id) values
    ('33333333-0000-0000-0000-000000000003', 1, 5, 185, '${SQUAT}'),
    ('33333333-0000-0000-0000-000000000003', 2, 5, 195, '${SQUAT}');
  insert into oauth_connections (user_id, provider, access_token) values
    ('${A}', 'strava', 'strava-token'), ('${A}', 'google', 'google-token');
`);

// ---- Act: apply 0003 twice (second run must be a no-op) -------------------
const migration = read("supabase/migrations/0003_full_app.sql");
await db.exec(migration);
await db.exec(migration);
check(true, "0003 applies twice");
const migration4 = read("supabase/migrations/0004_plan_builder.sql");
await db.exec(migration4);
await db.exec(migration4);
check(true, "0004 applies twice on a fresh schema");

// ---- Strava cleanup -------------------------------------------------------
check(
  !(await one("select 1 as x from information_schema.columns where table_name = 'run_details' and column_name = 'strava_name'")),
  "strava_name dropped",
);
const notes = await q("select session_id, notes from run_details order by session_id");
check(notes[0].notes === "Morning Run\nfelt good", `strava name prepended to notes: ${JSON.stringify(notes[0].notes)}`);
check(notes[1].notes === "Evening Run", "strava name moved into empty notes");
const providers = await q("select provider::text from oauth_connections");
check(providers.length === 1 && providers[0].provider === "google", "strava token deleted, google kept");
const labels = await q(
  "select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'oauth_provider'",
);
check(labels.length === 1 && labels[0].enumlabel === "google", "oauth_provider enum is {google}");
check(!(await one("select 1 as x from pg_type where typname = 'oauth_provider_old'")), "old enum dropped");

// ---- Settings -------------------------------------------------------------
await db.exec(`insert into user_settings (user_id) values ('${A}')`);
check((await one(`select weight_unit from user_settings where user_id = '${A}'`)).weight_unit === "lb", "weight_unit defaults to lb");
await expectError(`update user_settings set weight_unit = 'st' where user_id = '${A}'`, [], "check", "weight_unit rejects other units");

// ---- Anon cannot call RPCs ------------------------------------------------
await as("anon");
await expectError("select log_run('2026-11-03', 'easy', 5, 1500)", [], "permission denied", "anon blocked from log_run");
await expectError("select log_lift(null, '2026-11-03', 'legs', null, '[]')", [], "permission denied", "anon blocked from log_lift");

// ---- Runs -----------------------------------------------------------------
await as(A);
const logged = (await one("select log_run('2026-11-03', 'easy', 5, 1500, 150, 40, '  nice  ') as id")).id;
const loggedRow = await one(
  "select s.status, s.ad_hoc, r.actual_pace_sec_per_km, r.notes from sessions s join run_details r on r.session_id = s.id where s.id = $1",
  [logged],
);
check(loggedRow.status === "completed" && loggedRow.ad_hoc === true, "log_run creates completed ad-hoc session");
check(loggedRow.actual_pace_sec_per_km === 300 && loggedRow.notes === "nice", "log_run computes pace and trims notes");

const sessionCount = async () => Number((await one("select count(*) as n from sessions")).n);
let before = await sessionCount();
await expectError("select log_run('2026-11-03', 'easy', 0, 1500)", [], "Distance", "log_run rejects zero distance");
await expectError("select log_run('2026-11-03', 'easy', 5, 1500, 400)", [], "Average HR", "log_run rejects bad HR");
check((await sessionCount()) === before, "failed log_run writes nothing");

const planned = (await one("select plan_run('2026-11-05', 'tempo', '07:30', null, 10, 3000) as id")).id;
const plannedRow = await one(
  "select s.status, s.planned_start_time::text as t, s.planned_duration_min, r.target_pace_sec_per_km from sessions s join run_details r on r.session_id = s.id where s.id = $1",
  [planned],
);
check(plannedRow.status === "planned" && plannedRow.t === "07:30:00", "plan_run stores status and time");
check(plannedRow.target_pace_sec_per_km === 300 && plannedRow.planned_duration_min === 50, "plan_run derives pace and duration");

await db.query("select complete_run($1, 10.2, 3100, 165, null, 'windy')", [planned]);
const completed = await one(
  "select s.status, r.actual_distance_km::text as d, r.actual_pace_sec_per_km from sessions s join run_details r on r.session_id = s.id where s.id = $1",
  [planned],
);
check(completed.status === "completed" && completed.d === "10.2" && completed.actual_pace_sec_per_km === 304, "complete_run records actuals");

// ---- Routines -------------------------------------------------------------
const routine = (
  await one(
    `select save_routine(null, 'Leg day', '[{"exercise_id":"${SQUAT}","target_sets":5,"target_reps":5},{"exercise_id":"${BENCH}"}]') as id`,
  )
).id;
check((await q("select * from routine_exercises where routine_id = $1 order by position", [routine])).length === 2, "save_routine creates exercises");
await db.query(`select save_routine($1, 'Leg day v2', '[{"exercise_id":"${BENCH}","target_sets":3}]')`, [routine]);
const re = await q("select exercise_id, position from routine_exercises where routine_id = $1", [routine]);
check(re.length === 1 && re[0].exercise_id === BENCH && re[0].position === 1, "save_routine replaces exercises");
await db.query(`select save_routine(null, 'Push', '[{"exercise_id":"${BENCH}"}]')`);
await expectError(`select save_routine(null, 'Push', '[{"exercise_id":"${BENCH}"}]')`, [], "already have a routine", "duplicate routine name");
await expectError(`select save_routine(null, 'Sneaky', '[{"exercise_id":"${B_CUSTOM}"}]')`, [], "unknown", "routine cannot use another user's exercise");

// ---- Lifts + PRs ----------------------------------------------------------
const sets = (rows) => JSON.stringify(rows);
before = await sessionCount();
await expectError(
  "select log_lift(null, '2026-11-02', 'legs', null, $1)",
  [sets([{ exercise_id: SQUAT, reps: 5, weight: 200, rpe: 11 }])],
  "RPE",
  "log_lift rejects RPE 11",
);
await expectError(
  "select log_lift(null, '2026-11-02', 'legs', null, $1)",
  [sets([{ exercise_id: B_CUSTOM, reps: 5, weight: 200 }])],
  "unknown exercise",
  "log_lift cannot use another user's exercise",
);
await expectError("select log_lift(null, '2026-11-02', 'legs', null, '[]')", [], "at least one set", "log_lift requires sets");
await expectError(
  "select log_lift(null, '2026-11-02', 'legs', null, $1)",
  [sets([{ exercise_id: SQUAT, reps: 5, set_type: "bogus" }])],
  "invalid value",
  "log_lift rejects unknown set_type",
);
check((await sessionCount()) === before, "failed log_lift writes nothing");

const lift1 = (
  await one("select log_lift(null, '2026-11-02', 'legs', 'heavy', $1) as id", [
    sets([
      { exercise_id: SQUAT, set_type: "warmup", reps: 5, weight: 300 },
      { exercise_id: SQUAT, reps: 5, weight: 205 },
      { exercise_id: BENCH, reps: 8, weight: 135 },
      { exercise_id: SQUAT, reps: 3, weight: 215 },
    ]),
  ])
).id;
const numbered = await q(
  "select exercise_id, set_number, set_type::text, weight::text from lift_sets where lift_details_id = $1 order by created_at, set_number",
  [lift1],
);
const squatNums = numbered.filter((r) => r.exercise_id === SQUAT).map((r) => r.set_number).sort();
check(JSON.stringify(squatNums) === "[1,2,3]", `set_number counts per exercise: ${squatNums}`);
check((await one("select ad_hoc, status from sessions where id = $1", [lift1])).ad_hoc === true, "ad-hoc lift flagged");
const order = numbered.map((r) => `${r.exercise_id === SQUAT ? "S" : "B"}${r.set_number}`).join(",");
check(order === "S1,S2,B1,S3", `sets keep array order by created_at: ${order}`);

const prs = async (exercise) =>
  q(
    "select record_type::text as t, value::text as v, s.planned_date::text as d from personal_records pr join sessions s on s.id = pr.session_id where pr.exercise_id = $1 order by s.planned_date, t",
    [exercise],
  );
let squatPrs = await prs(SQUAT);
// Pre-existing 10-29 session (195x5) is the baseline; 11-02 beats it.
const heaviest = squatPrs.filter((r) => r.t === "heaviest_weight").map((r) => `${r.d}:${r.v}`);
check(JSON.stringify(heaviest) === '["2026-10-29:195","2026-11-02:215"]', `heaviest chronology (warmup ignored): ${heaviest}`);
const e1rm = squatPrs.find((r) => r.t === "best_e1rm" && r.d === "2026-11-02");
check(e1rm && e1rm.v === "239.2", `e1rm = max(205*(1+5/30), 215*(1+3/30)) = 239.2 vs 236.5 -> ${e1rm && e1rm.v}`);

// Backdated heavier session becomes the baseline and later sessions are re-judged.
const lift0 = (
  await one("select log_lift(null, '2026-10-20', 'legs', null, $1) as id", [sets([{ exercise_id: SQUAT, reps: 5, weight: 250 }])])
).id;
squatPrs = await prs(SQUAT);
check(
  JSON.stringify(squatPrs.filter((r) => r.t === "heaviest_weight").map((r) => r.d)) === '["2026-10-20"]',
  "backdated heavier lift is the only heaviest PR",
);

await db.query("select delete_session($1)", [lift0]);
squatPrs = await prs(SQUAT);
check(squatPrs.filter((r) => r.t === "heaviest_weight").length === 2, "deleting a lift rebuilds PRs");

await db.query("select set_session_status($1, 'skipped')", [lift1]);
check((await prs(BENCH)).length === 0, "skipping a lift removes its PRs");
await db.query("select set_session_status($1, 'completed')", [lift1]);
check((await prs(BENCH)).length > 0, "un-skipping restores PRs");

// Completing a planned lift (and moving it to the day it was done).
const plannedLift = (await one("select plan_lift('2026-11-06', 'push', '18:00', 60, $1, 'plan notes') as id", [routine])).id;
await db.query("select log_lift($1, '2026-11-07', 'push', 'done', $2)", [plannedLift, sets([{ exercise_id: BENCH, reps: 5, weight: 155 }])]);
const done = await one(
  "select s.status, s.planned_date::text as d, s.routine_id, l.notes, l.completed_at is not null as c, p.week_start_date::text as w from sessions s join lift_details l on l.session_id = s.id join plans p on p.id = s.plan_id where s.id = $1",
  [plannedLift],
);
check(done.status === "completed" && done.d === "2026-11-07" && done.c && done.notes === "done", "log_lift completes planned lift");
check(done.routine_id === routine && done.w === "2026-11-02", "completed lift keeps routine, plan matches week");
await expectError("select log_lift($1, '2026-11-07', 'x', null, $2)", [planned, sets([{ exercise_id: BENCH, reps: 1 }])], "Lift not found", "log_lift rejects run session");
await expectError("select complete_run($1, 5, 1500)", [plannedLift], "Run not found", "complete_run rejects lift session");

// Reschedule across weeks.
await db.query("select reschedule_session($1, '2026-11-10', '06:00')", [plannedLift]);
const moved = await one(
  "select s.planned_date::text as d, s.planned_start_time::text as t, p.week_start_date::text as w from sessions s join plans p on p.id = s.plan_id where s.id = $1",
  [plannedLift],
);
check(moved.d === "2026-11-10" && moved.t === "06:00:00" && moved.w === "2026-11-09", "reschedule moves across weeks");

// ---- Conflict rules seeding ----------------------------------------------
await db.query("select seed_default_conflict_rules()");
await db.query("select seed_default_conflict_rules()");
check(Number((await one("select count(*) as n from conflict_rules")).n) === 4, "default rules seeded exactly once");

// ---- RLS isolation --------------------------------------------------------
await as(B);
check(Number((await one("select count(*) as n from sessions")).n) === 0, "B sees none of A's sessions");
check(Number((await one("select count(*) as n from personal_records")).n) === 0, "B sees none of A's PRs");
await expectError("select delete_session($1)", [lift1], "Session not found", "B cannot delete A's session");
await expectError("select complete_run($1, 5, 1500)", [planned], "Run not found", "B cannot complete A's run");
await expectError("select reschedule_session($1, '2026-11-11')", [lift1], "Session not found", "B cannot move A's session");
await expectError("select set_session_status($1, 'skipped')", [lift1], "Session not found", "B cannot skip A's session");
await expectError("select plan_lift('2026-11-06', 'push', null, null, $1)", [routine], "Routine not found", "B cannot use A's routine");
await expectError(`select save_routine($1, 'hijack', '[{"exercise_id":"${BENCH}"}]')`, [routine], "Routine not found", "B cannot edit A's routine");
await db.query("select log_lift(null, '2026-11-03', 'pull', null, $1)", [sets([{ exercise_id: B_CUSTOM, reps: 5, weight: 50 }])]);
check(Number((await one("select count(*) as n from personal_records")).n) > 0, "B can log with own custom exercise");

await as(A);
check(Number((await one(`select count(*) as n from personal_records where exercise_id = '${B_CUSTOM}'`)).n) === 0, "A cannot see B's PRs");

// ---- Editing a logged lift -------------------------------------------------
// Replacing lift1's sets (squat + bench) with squat only must clear bench PRs
// and renumber squat sets.
await db.query("select log_lift($1, '2026-11-02', 'legs', 'edited', $2)", [
  lift1,
  sets([
    { exercise_id: SQUAT, reps: 5, weight: 205 },
    { exercise_id: SQUAT, reps: 2, weight: 225 },
  ]),
]);
const edited = await q("select set_number, weight::text as w from lift_sets where lift_details_id = $1 order by set_number", [lift1]);
check(JSON.stringify(edited.map((r) => `${r.set_number}:${r.w}`)) === '["1:205","2:225"]', `edit replaces sets: ${JSON.stringify(edited)}`);
check(
  (await q("select 1 from personal_records where session_id = $1 and exercise_id = $2", [lift1, BENCH])).length === 0,
  "edit removes PRs for an exercise no longer in the lift",
);
check(
  (await prs(SQUAT)).some((r) => r.t === "heaviest_weight" && r.d === "2026-11-02" && r.v === "225"),
  "edit re-judges PRs with new weights",
);
check((await one("select status from sessions where id = $1", [lift1])).status === "completed", "edited lift stays completed");

// ---- Validation on planning and routines -----------------------------------
before = await sessionCount();
await expectError("select plan_run('2026-11-05', 'easy', null, 0)", [], "Planned duration", "plan_run rejects 0 minutes");
await expectError("select plan_run('2026-11-05', 'easy', null, null, -1)", [], "Target distance", "plan_run rejects negative distance");
await expectError("select plan_run('2026-11-05', null)", [], "Run type", "plan_run requires run type");
await expectError("select plan_lift('2026-11-05', '  ')", [], "Focus", "plan_lift requires focus");
await expectError("select plan_lift('2026-11-05', 'legs', null, 2000)", [], "Planned duration", "plan_lift rejects > 1440 minutes");
await expectError(
  "select log_lift(null, '2026-11-02', 'legs', null, $1)",
  [sets([{ exercise_id: SQUAT, reps: 1, weight: 5001 }])],
  "weight",
  "log_lift rejects weight over 5000",
);
check((await sessionCount()) === before, "failed planning writes nothing");
await expectError(`select save_routine(null, 'Zero', '[{"exercise_id":"${SQUAT}","target_sets":0}]')`, [], "target sets", "save_routine rejects 0 sets");
await expectError("select save_routine(null, '  ', $1)", [JSON.stringify([{ exercise_id: SQUAT }])], "name is required", "save_routine requires a name");
await expectError("select save_routine(null, 'Empty', '[]')", [], "at least one exercise", "save_routine requires exercises");

// ---- Run lifecycle odds and ends -------------------------------------------
const tmpRun = (await one("select plan_run('2026-11-12', 'easy', '06:00') as id")).id;
await db.query("select reschedule_session($1, '2026-11-12', null)", [tmpRun]);
check((await one("select planned_start_time from sessions where id = $1", [tmpRun])).planned_start_time === null, "reschedule can clear the time");
await db.query("select set_session_status($1, 'skipped')", [tmpRun]);
check((await one("select status from sessions where id = $1", [tmpRun])).status === "skipped", "runs can be skipped");
await db.query("select delete_session($1)", [tmpRun]);
check(!(await one("select 1 as x from sessions where id = $1", [tmpRun])), "delete_session removes a run");
check(!(await one("select 1 as x from run_details where session_id = $1", [tmpRun])), "deleting a run removes its details");

// ---- Tables the app writes directly (busy blocks, rules, settings) ---------
await db.query(
  `insert into busy_blocks (user_id, title, start_time, end_time, source, google_event_id)
   values ($1, 'Work', '2026-11-04T14:00Z', '2026-11-04T22:00Z', 'google_calendar', 'evt-1')
   on conflict (user_id, google_event_id) do update set title = excluded.title`,
  [A],
);
await db.query(
  `insert into busy_blocks (user_id, title, start_time, end_time, source, google_event_id)
   values ($1, 'Work (moved)', '2026-11-04T15:00Z', '2026-11-04T23:00Z', 'google_calendar', 'evt-1')
   on conflict (user_id, google_event_id) do update set title = excluded.title`,
  [A],
);
check(Number((await one("select count(*) as n from busy_blocks where google_event_id = 'evt-1'")).n) === 1, "sync upsert key dedupes events");
await expectError(
  "insert into busy_blocks (user_id, title, start_time, end_time, source) values ($1, 'x', '2026-11-04T10:00Z', '2026-11-04T09:00Z', 'manual')",
  [A],
  "busy_blocks_time_order",
  "busy block end must be after start",
);
await db.query("insert into busy_blocks (user_id, title, start_time, end_time, source) values ($1, 'Class', '2026-11-05T14:00Z', '2026-11-05T15:00Z', 'manual')", [A]);
await db.query("insert into exercise_rest_prefs (user_id, exercise_id, rest_seconds) values ($1, $2, 120)", [A, SQUAT]);
await expectError("update exercise_rest_prefs set rest_seconds = 4000 where user_id = $1", [A], "check", "rest seconds capped at 3600");

await as(B);
await expectError(
  "insert into busy_blocks (user_id, title, start_time, end_time, source) values ($1, 'x', '2026-11-04T09:00Z', '2026-11-04T10:00Z', 'manual')",
  [A],
  "row-level security",
  "B cannot add busy time for A",
);
const bWrites = [
  ["update busy_blocks set title = 'pwned'", "busy_blocks"],
  ["update conflict_rules set enabled = false", "conflict_rules"],
  ["update user_settings set weight_unit = 'kg'", "user_settings"],
  ["update routines set name = 'pwned'", "routines"],
  ["update exercise_rest_prefs set rest_seconds = 1", "exercise_rest_prefs"],
  ["update oauth_connections set access_token = 'x'", "oauth_connections"],
  ["delete from busy_blocks", "busy_blocks"],
  ["delete from conflict_rules", "conflict_rules"],
  ["delete from routines", "routines"],
];
for (const [sql, table] of bWrites) {
  const res = await db.query(`${sql} where user_id = $1`, [A]);
  check((res.affectedRows ?? 0) === 0, `B cannot change A's ${table} (${sql.split(" ")[0]})`);
}
await expectError(
  "insert into exercises (name, is_custom, user_id) values ('x', true, $1)",
  [A],
  "row-level security",
  "B cannot create custom exercises for A",
);
await expectError("select log_lift($1, '2026-11-03', 'legs', null, $2)", [lift1, sets([{ exercise_id: SQUAT, reps: 1 }])], "Lift not found", "B cannot edit A's lift");
await db.query("select seed_default_conflict_rules()");
check(Number((await one("select count(*) as n from conflict_rules")).n) === 4, "B gets their own default rules");

await as(A);
check(Number((await one("select count(*) as n from busy_blocks")).n) === 2, "A's busy blocks intact");
check(Number((await one("select count(*) as n from conflict_rules where enabled")).n) === 4, "A's rules intact");
check((await one("select name from routines where id = $1", [routine])).name === "Leg day v2", "A's routine intact");
check(Number((await one("select count(*) as n from conflict_rules")).n) === 4, "A still sees only their own 4 rules");

// ---- Signed in without a user id --------------------------------------------
await db.exec("reset role; set role authenticated; select set_config('request.jwt.claim.sub', '', false)");
await expectError("select ensure_plan('2026-11-03')", [], "Not authenticated", "ensure_plan needs a user");
await expectError("select seed_default_conflict_rules()", [], "Not authenticated", "seeding needs a user");

// ---- Plan builder: training_profiles ----------------------------------------
const C = "cccccccc-0000-0000-0000-000000000003";
await db.exec("reset role");
await db.exec(`insert into auth.users values ('${C}')`);

const profileSql = (over = {}) => {
  const v = {
    user_id: A, preset: "'hybrid'", w_strength: 40, w_hypertrophy: 30, w_endurance: 30, days_per_week: 4,
    minutes_per_day: 60, rest_days: "'{7}'", goal_type: "'none'", race_distance_km: "null", race_date: "null", ...over,
  };
  const uid = typeof v.user_id === "string" && v.user_id.startsWith("'") ? v.user_id : `'${v.user_id}'`;
  return `insert into training_profiles (user_id, preset, w_strength, w_hypertrophy, w_endurance, days_per_week, minutes_per_day, rest_days, goal_type, race_distance_km, race_date)
    values (${uid}, ${v.preset}, ${v.w_strength}, ${v.w_hypertrophy}, ${v.w_endurance}, ${v.days_per_week}, ${v.minutes_per_day}, ${v.rest_days}, ${v.goal_type}, ${v.race_distance_km}, ${v.race_date})`;
};

await as(A);
await db.exec(profileSql());
const prof = await one("select * from training_profiles where user_id = $1", [A]);
check(prof.experience === "intermediate" && prof.goal_type === "none", "profile defaults");
check(JSON.stringify(prof.minutes_by_weekday) === "{}" && prof.rest_days.join() === "7", "profile jsonb/array defaults");
await db.exec(
  `${profileSql({ w_strength: 50, w_hypertrophy: 25, w_endurance: 25, days_per_week: 5 })}
   on conflict (user_id) do update set w_strength = excluded.w_strength, w_hypertrophy = excluded.w_hypertrophy, w_endurance = excluded.w_endurance, days_per_week = excluded.days_per_week`,
);
const prof2 = await one("select w_strength, days_per_week from training_profiles where user_id = $1", [A]);
check(prof2.w_strength === 50 && prof2.days_per_week === 5, "profile upsert updates");
const upd1 = await one("select updated_at > created_at as later from training_profiles where user_id = $1", [A]);
check(upd1.later === true, "profile updated_at trigger fires");

await db.exec("reset role");
await db.exec("delete from training_profiles");
await as(A);
await expectError(profileSql({ w_strength: 50, w_hypertrophy: 30, w_endurance: 30 }), [], "training_profiles_weights_sum", "weights must sum to 100");
await expectError(profileSql({ days_per_week: 1 }), [], "check", "days_per_week 1 rejected");
await expectError(profileSql({ days_per_week: 8 }), [], "check", "days_per_week 8 rejected");
await expectError(profileSql({ minutes_per_day: 5 }), [], "check", "minutes_per_day 5 rejected");
await expectError(profileSql({ minutes_per_day: 301 }), [], "check", "minutes_per_day 301 rejected");
await expectError(profileSql({ rest_days: "'{8}'" }), [], "check", "rest day 8 rejected");
await expectError(profileSql({ rest_days: "'{0}'" }), [], "check", "rest day 0 rejected");
await expectError(profileSql({ preset: "'bodybuilder'" }), [], "check", "unknown preset rejected");
await expectError(profileSql({ goal_type: "'marathon'" }), [], "check", "unknown goal_type rejected");
await expectError(profileSql({ goal_type: "'race'", race_distance_km: 10 }), [], "training_profiles_race_goal", "race goal needs a date");
await expectError(profileSql({ goal_type: "'race'", race_date: "'2027-03-01'" }), [], "training_profiles_race_goal", "race goal needs a distance");
await expectError(profileSql({ race_distance_km: 0 }), [], "check", "race distance 0 rejected");
await expectError(profileSql({ race_distance_km: 1001 }), [], "check", "race distance over 1000 rejected");
check(Number((await one("select count(*) as n from training_profiles")).n) === 0, "rejected profiles wrote nothing");
await db.exec(profileSql({ goal_type: "'race'", race_distance_km: 21.1, race_date: "'2027-03-01'" }));
check(Number((await one("select count(*) as n from training_profiles")).n) === 1, "race profile with both fields accepted");
await expectError("update training_profiles set minutes_by_weekday = '[]' where user_id = $1", [A], "check", "minutes_by_weekday must be an object");
await expectError("update training_profiles set experience = 'god' where user_id = $1", [A], "check", "unknown experience rejected");

await as(B);
check(Number((await one("select count(*) as n from training_profiles")).n) === 0, "B cannot see A's profile");
await expectError(profileSql({ user_id: A }), [], "row-level security", "B cannot create A's profile");
check(((await db.query("update training_profiles set days_per_week = 2")).affectedRows ?? 0) === 0, "B cannot update A's profile");
check(((await db.query("delete from training_profiles")).affectedRows ?? 0) === 0, "B cannot delete A's profile");
await db.exec(profileSql({ user_id: B }));
await as(A);
check(Number((await one("select count(*) as n from training_profiles")).n) === 1, "A still sees only their own profile");

// ---- Plan builder: accept_training_block -------------------------------------
await as("anon");
await expectError("select accept_training_block('2026-11-30', 1, '2026-11-30', '{}', '[]', 's', 'v1', '[]', false)", [], "permission denied", "anon blocked from accept_training_block");
await expectError("select swap_sessions(gen_random_uuid(), gen_random_uuid())", [], "permission denied", "anon blocked from swap_sessions");

await as(A);
const sess = (o) => ({
  date: "2026-11-30", type: "run", run_type: "easy", focus: null, duration_min: 40, intensity: "easy",
  rationale: "Base run", prescription: { zone: 2 }, ...o,
});
const accept = (start, weeks, today, sessions, allowSame = false) =>
  one("select accept_training_block($1, $2, $3, $4, $5, $6, $7, $8, $9) as id", [
    start, weeks, today, JSON.stringify({ preset: "hybrid" }), JSON.stringify([{ constraint: "days", title: "t", detail: "d" }]),
    "A summary", "v1", JSON.stringify(sessions), allowSame,
  ]);
const counts = async () => ({
  blocks: Number((await one("select count(*) as n from training_blocks")).n),
  sessions: await sessionCount(),
  plans: Number((await one("select count(*) as n from plans")).n),
  runs: Number((await one("select count(*) as n from run_details")).n),
  lifts: Number((await one("select count(*) as n from lift_details")).n),
});

// Validation failures write nothing.
const snap = JSON.stringify(await counts());
const bad = [
  ["not a Monday", () => accept("2026-12-01", 2, "2026-12-01", [sess({ date: "2026-12-01" })]), "Monday"],
  ["weeks 0", () => accept("2026-11-30", 0, "2026-11-30", [sess()]), "weeks"],
  ["weeks 13", () => accept("2026-11-30", 13, "2026-11-30", [sess()]), "weeks"],
  ["date after block", () => accept("2026-11-30", 2, "2026-11-30", [sess(), sess({ date: "2026-12-14" })]), "outside the block"],
  ["date before block", () => accept("2026-11-30", 2, "2026-11-30", [sess({ date: "2026-11-29" })]), "outside the block"],
  ["run without run_type", () => accept("2026-11-30", 2, "2026-11-30", [sess(), sess({ run_type: null })]), "run type"],
  ["bogus run_type", () => accept("2026-11-30", 2, "2026-11-30", [sess({ run_type: "jog" })]), "run type"],
  ["lift without focus", () => accept("2026-11-30", 2, "2026-11-30", [sess({ type: "lift", run_type: null, focus: " " })]), "focus"],
  ["lift focus too long", () => accept("2026-11-30", 2, "2026-11-30", [sess({ type: "lift", run_type: null, focus: "x".repeat(51) })]), "focus"],
  ["bad type", () => accept("2026-11-30", 2, "2026-11-30", [sess({ type: "swim" })]), "type"],
  ["bad intensity", () => accept("2026-11-30", 2, "2026-11-30", [sess(), sess({ intensity: "brutal" })]), "intensity"],
  ["bad duration 0", () => accept("2026-11-30", 2, "2026-11-30", [sess({ duration_min: 0 })]), "duration"],
  ["bad duration 1441", () => accept("2026-11-30", 2, "2026-11-30", [sess({ duration_min: 1441 })]), "duration"],
  ["fractional duration", () => accept("2026-11-30", 2, "2026-11-30", [sess({ duration_min: 30.5 })]), "duration"],
  ["rationale too long", () => accept("2026-11-30", 2, "2026-11-30", [sess({ rationale: "x".repeat(501) })]), "rationale"],
  ["prescription not object", () => accept("2026-11-30", 2, "2026-11-30", [sess({ prescription: [1] })]), "prescription"],
  ["empty array", () => accept("2026-11-30", 2, "2026-11-30", []), "at least one session"],
  ["too many", () => accept("2026-11-30", 12, "2026-11-30", Array.from({ length: 201 }, () => sess())), "Too many"],
  ["element not object", () => accept("2026-11-30", 2, "2026-11-30", [5]), "malformed"],
];
for (const [label, fn, fragment] of bad) {
  try {
    await fn();
    check(false, `accept_training_block ${label}: expected error`);
  } catch (e) {
    check(String(e.message).toLowerCase().includes(fragment.toLowerCase()), `accept_training_block ${label}: got "${e.message}"`);
  }
}
check(JSON.stringify(await counts()) === snap, "failed accept_training_block calls write nothing");

// Happy path across two weeks (two plans).
const block1 = (
  await accept("2026-11-30", 2, "2026-11-30", [
    sess({ date: "2026-11-30", duration_min: 45 }),
    sess({ date: "2026-11-30", type: "lift", run_type: null, focus: " Legs ", duration_min: 60, intensity: "hard", rationale: "Heavy", prescription: { sets: 5 } }),
    sess({ date: "2026-12-01", type: "lift", run_type: null, focus: "push", duration_min: 50, intensity: "moderate", rationale: "Upper", prescription: { sets: 4 } }),
    sess({ date: "2026-12-08", run_type: "tempo", duration_min: 35, intensity: "hard", rationale: "Tempo", prescription: { zone: 4 } }),
  ])
).id;
check(!!block1, "accept_training_block returns the block id");
const b1 = await one("select * from training_blocks where id = $1", [block1]);
check(b1.status === "active" && b1.weeks === 2 && b1.summary === "A summary" && b1.generator_version === "v1", "block row stored");
check(b1.relaxations[0].constraint === "days" && b1.profile_snapshot.preset === "hybrid", "block jsonb stored");
const b1s = await q(
  `select s.id, s.type::text as type, s.planned_date::text as d, s.status::text as status, s.planned_duration_min as dur, s.intensity, s.rationale,
     s.prescription, s.block_id, s.planned_start_time, p.week_start_date::text as w, r.run_type::text as run_type, r.target_duration_sec,
     l.focus, l.notes
   from sessions s join plans p on p.id = s.plan_id
   left join run_details r on r.session_id = s.id left join lift_details l on l.session_id = s.id
   where s.block_id = $1 order by s.planned_date, s.type, s.created_at`,
  [block1],
);
check(b1s.length === 4, `4 block sessions created: ${b1s.length}`);
check(b1s.every((x) => x.status === "planned" && x.planned_start_time === null && x.block_id === block1), "block sessions are planned, untimed, linked");
const run0 = b1s.find((x) => x.d === "2026-11-30" && x.type === "run");
check(run0.dur === 45 && run0.target_duration_sec === 2700 && run0.run_type === "easy" && run0.intensity === "easy" && run0.rationale === "Base run", "run session details");
check(JSON.stringify(run0.prescription) === '{"zone":2}', "run prescription stored");
const lift0b = b1s.find((x) => x.type === "lift" && x.d === "2026-11-30");
check(lift0b.focus === "Legs" && lift0b.notes === null && lift0b.dur === 60 && lift0b.intensity === "hard" && lift0b.prescription.sets === 5, "lift session details");
const run2 = b1s.find((x) => x.d === "2026-12-08");
check(run2.w === "2026-12-07" && run2.target_duration_sec === 2100 && run2.run_type === "tempo", "second week uses its own plan");
check(b1s.find((x) => x.d === "2026-12-01").w === "2026-11-30", "first week plan is the Monday");
check(Number((await one("select count(distinct plan_id) as n from sessions where block_id = $1", [block1])).n) === 2, "block spans 2 plans");
check(Number((await one("select count(*) as n from plans where user_id = $1 and week_start_date in ('2026-11-30','2026-12-07')", [A])).n) === 2, "no duplicate plans created");

// allow_same_day false/absent leaves rules alone.
const rulesParams = async (uid) =>
  q("select rule_type::text as t, params from conflict_rules where user_id = $1 order by rule_type::text", [uid]);
let ruleRows = await rulesParams(A);
check(ruleRows.every((r) => r.params.allow_same_day === undefined), "allow_same_day absent when not requested");

// Complete one session, keep a planned past one, then replace the block.
const doneRun = run0.id;
await db.query("select complete_run($1, 7, 2500)", [doneRun]);
const plannedPastLift = lift0b.id; // planned, 2026-11-30 < p_today
const futureLift = b1s.find((x) => x.d === "2026-12-01").id;
const futureRun = run2.id;
const otherBefore = Number((await one("select count(*) as n from sessions where block_id is null")).n);
const block2 = (
  await accept(
    "2026-11-30", 2, "2026-12-01",
    [sess({ date: "2026-12-02", duration_min: 30, rationale: "New plan" })],
    true,
  )
).id;
const oldB = await one("select status from training_blocks where id = $1", [block1]);
const newB = await one("select status from training_blocks where id = $1", [block2]);
check(oldB.status === "replaced" && newB.status === "active", "old block replaced, new block active");
check(Number((await one("select count(*) as n from training_blocks where user_id = $1 and status = 'active'", [A])).n) === 1, "exactly one active block");
check(!(await one("select 1 as x from sessions where id = $1", [futureLift])), "old planned future lift deleted");
check(!(await one("select 1 as x from sessions where id = $1", [futureRun])), "old planned future run deleted");
check(!(await one("select 1 as x from lift_details where session_id = $1", [futureLift])), "deleted session's details cascade");
check(!!(await one("select 1 as x from sessions where id = $1 and status = 'completed'", [doneRun])), "old completed session kept");
check(!!(await one("select 1 as x from sessions where id = $1 and status = 'planned'", [plannedPastLift])), "old planned past session kept");
check(!!(await one("select 1 as x from run_details where session_id = $1", [doneRun])), "completed session details kept");
check(Number((await one("select count(*) as n from sessions where block_id = $1", [block2])).n) === 1, "new block has its session");
check(Number((await one("select count(*) as n from sessions where block_id is null")).n) === otherBefore, "unrelated sessions untouched");
check(Number((await one("select count(*) as n from sessions where block_id = $1", [block1])).n) === 2, "old block keeps completed + past sessions");

// Same-day hard rule option.
ruleRows = await rulesParams(A);
const b2b = ruleRows.filter((r) => r.t === "no_back_to_back_hard");
check(b2b.length === 1 && b2b[0].params.allow_same_day === true, "allow_same_day set on no_back_to_back_hard");
check(Array.isArray(b2b[0].params.hard_run_types), "no_back_to_back_hard keeps its other params");
const others = ruleRows.filter((r) => r.t !== "no_back_to_back_hard");
check(others.length === 3 && others.every((r) => r.params.allow_same_day === undefined), "other rules untouched by allow_same_day");
check(Number((await one("select count(*) as n from conflict_rules where user_id = $1", [A])).n) === 4, "no duplicate rules seeded for A");

// A user with no rules yet gets them seeded when asking for same-day hard.
await as(C);
check(Number((await one("select count(*) as n from conflict_rules")).n) === 0, "C starts with no rules");
const cBlock = (await accept("2026-11-30", 1, "2026-11-30", [sess()], true)).id;
const cRules = await rulesParams(C);
check(cRules.length === 4 && cRules.find((r) => r.t === "no_back_to_back_hard").params.allow_same_day === true, "rules seeded and allow_same_day set for new user");
const cFalse = await accept("2026-11-30", 1, "2026-11-30", [sess()], false);
check((await rulesParams(C)).find((r) => r.t === "no_back_to_back_hard").params.allow_same_day === true, "false does not clear a prior allow_same_day");
check(cFalse.id !== cBlock, "re-accepting makes a new block");

// RLS on blocks and new session columns as B.
await as(B);
check(Number((await one("select count(*) as n from training_blocks")).n) === 0, "B cannot see A's or C's blocks");
check(Number((await one("select count(*) as n from sessions where block_id is not null")).n) === 0, "B cannot see block sessions");
await expectError(
  "insert into training_blocks (user_id, start_date, weeks, profile_snapshot, generator_version) values ($1, '2026-11-30', 1, '{}', 'v1')",
  [A], "row-level security", "B cannot create a block for A",
);
check(((await db.query("update training_blocks set status = 'replaced'")).affectedRows ?? 0) === 0, "B cannot update A's blocks");
check(((await db.query("delete from training_blocks")).affectedRows ?? 0) === 0, "B cannot delete A's blocks");
check(((await db.query("update sessions set intensity = 'hard', rationale = 'x'")).affectedRows ?? 0) > 0, "B can update only their own sessions (none here besides own)");
await as(A);
check((await one("select intensity from sessions where id = $1", [plannedPastLift])).intensity === "hard", "B could not change A's session columns");
await expectError("update sessions set intensity = 'brutal' where id = $1", [plannedPastLift], "sessions_intensity_check", "intensity check");
await expectError("update sessions set rationale = $2 where id = $1", [plannedPastLift, "x".repeat(501)], "sessions_rationale_length", "rationale length check");
await expectError("update sessions set prescription = '[]' where id = $1", [plannedPastLift], "sessions_prescription_object", "prescription must be an object");
await as(B);
await expectError("select accept_training_block('2026-11-30', 1, '2026-11-30', '{}', '[]', 's', 'v1', $1, false)", [JSON.stringify([sess({ date: "2026-12-30" })])], "outside the block", "B validation runs");
const bBlock = (await one("select accept_training_block('2026-11-30', 1, '2026-11-30', '{}', '[]', null, 'v1', $1, false) as id", [JSON.stringify([sess()])])).id;
await as(A);
check(Number((await one("select count(*) as n from training_blocks where id = $1", [bBlock])).n) === 0, "A cannot see B's block");
check(Number((await one("select count(*) as n from training_blocks where user_id = $1 and status = 'active'", [A])).n) === 1, "B's accept did not touch A's active block");

// ---- Plan builder: swap_sessions ---------------------------------------------
const s1 = (await one("select plan_run('2026-12-14', 'easy', '07:00') as id")).id;
const s2 = (await one("select plan_lift('2026-12-03', 'push') as id")).id;
await db.query("select swap_sessions($1, $2)", [s1, s2]);
const sw = await q(
  "select s.id, s.planned_date::text as d, s.planned_start_time::text as t, p.week_start_date::text as w from sessions s join plans p on p.id = s.plan_id where s.id = any ($1::uuid[])",
  [[s1, s2]],
);
const sw1 = sw.find((x) => x.id === s1);
const sw2 = sw.find((x) => x.id === s2);
check(sw1.d === "2026-12-03" && sw1.t === null && sw1.w === "2026-11-30", `swap moved run to the lift's slot: ${JSON.stringify(sw1)}`);
check(sw2.d === "2026-12-14" && sw2.t === "07:00:00" && sw2.w === "2026-12-14", `swap moved lift to the run's slot: ${JSON.stringify(sw2)}`);
await expectError("select swap_sessions($1, $1)", [s1], "different", "swap rejects identical ids");
await expectError("select swap_sessions($1, $2)", [s1, doneRun], "Only planned sessions can be swapped", "swap rejects completed sessions");
await expectError("select swap_sessions($1, $2)", [doneRun, s1], "Only planned sessions can be swapped", "swap rejects completed sessions (a side)");
await expectError("select swap_sessions($1, gen_random_uuid())", [s1], "Session not found", "swap rejects unknown session");
await db.query("select set_session_status($1, 'skipped')", [s2]);
await expectError("select swap_sessions($1, $2)", [s1, s2], "Only planned sessions can be swapped", "swap rejects skipped sessions");
const bRun = (await as(B), await one("select plan_run('2026-12-20', 'easy') as id")).id;
await as(A);
await expectError("select swap_sessions($1, $2)", [s1, bRun], "Session not found", "A cannot swap with B's session");
await as(B);
await expectError("select swap_sessions($1, $2)", [bRun, s1], "Session not found", "B cannot swap with A's session");
await as(A);
check((await one("select planned_date::text as d from sessions where id = $1", [s1])).d === "2026-12-03", "failed swaps leave sessions alone");

// ---- Re-apply after data exists ------------------------------------------
await as(null);
await db.exec("reset role");
await db.exec(migration);
await db.exec(migration4);
check(Number((await one("select count(*) as n from sessions")).n) > 0, "re-running 0003 and 0004 keeps data");
check(Number((await one("select count(*) as n from training_blocks")).n) > 0, "re-running 0004 keeps blocks");
check(Number((await one("select count(*) as n from training_profiles")).n) > 0, "re-running 0004 keeps profiles");

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
