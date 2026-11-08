// Tests supabase/migrations/0003_full_app.sql against a replica of the live
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

// ---- Re-apply after data exists ------------------------------------------
await as(null);
await db.exec("reset role");
await db.exec(migration);
check(Number((await one("select count(*) as n from sessions")).n) > 0, "re-running 0003 keeps data");

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
