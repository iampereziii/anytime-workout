import { getTodayContext } from "@/lib/supabase/queries";
import { ok, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/program/today — today's program day + exact remaining work.
 * "Remaining" comes from lib/facts remainingToday — computed across AM/PM
 * split sessions (business rule 7 / Flow 7), never inferred.
 */
export async function GET() {
  try {
    const ctx = await getTodayContext();
    const byId = new Map(ctx.planned.map((p) => [p.id, p]));

    return ok({
      date: ctx.today,
      day_number: ctx.day_number,
      label: ctx.day?.label ?? null,
      day_notes: ctx.day?.notes ?? null,
      planned: ctx.planned.map((p) => ({
        planned_exercise_id: p.id,
        exercise_id: p.exercise.id,
        exercise_name: p.exercise.name,
        unit: p.exercise.unit,
        is_bodyweight: p.exercise.is_bodyweight,
        target_sets: p.target_sets,
        target_reps: p.target_reps,
        target_weight: p.target_weight,
        rest_seconds: p.rest_seconds,
        notes: p.notes,
        sort_order: p.sort_order,
      })),
      remaining: ctx.remaining.map((r) => {
        const p = byId.get(r.planned.id);
        return {
          planned_exercise_id: r.planned.id,
          exercise_id: r.planned.exercise_id,
          exercise_name: p?.exercise.name ?? "",
          sets_done: r.setsDone,
          sets_remaining: r.setsRemaining,
          target_sets: r.planned.target_sets,
          target_reps: r.planned.target_reps,
          target_weight: r.planned.target_weight,
          rest_seconds: r.planned.rest_seconds,
          notes: r.planned.notes,
        };
      }),
      days_since_last_workout: ctx.days_since_last_workout,
      detraining: ctx.detraining,
      last_workout_date: ctx.last_workout_date,
    });
  } catch (e) {
    return failFrom(e);
  }
}
