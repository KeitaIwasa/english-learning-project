import { executeReadingGeneration, getLatestJobForDate, markTimedOutActiveJobs, resolveTargetDate } from "@/app/api/reading/_jobs";
import { createAdminSupabaseClient } from "@/lib/service";

type AppSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

export function resolveReadingTargetDate(rawDate: unknown) {
  return resolveTargetDate(rawDate);
}

export async function getReadingGenerationStatus(params: {
  adminClient: AppSupabaseClient;
  userId: string;
  rawDate: unknown;
}) {
  const targetDate = resolveReadingTargetDate(params.rawDate);
  await markTimedOutActiveJobs({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate
  });

  const latest = await getLatestJobForDate({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate
  });

  return {
    targetDate,
    latest
  };
}

export async function enqueueReadingGeneration(params: {
  adminClient: AppSupabaseClient;
  userId: string;
  rawDate: unknown;
  force: boolean;
  profileId?: string;
}) {
  const targetDate = resolveReadingTargetDate(params.rawDate);
  const result = await executeReadingGeneration({
    adminClient: params.adminClient,
    userId: params.userId,
    targetDate,
    triggerType: "manual",
    force: params.force,
    profileId: params.profileId
  });

  return {
    targetDate,
    result
  };
}
