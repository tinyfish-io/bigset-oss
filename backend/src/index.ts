import Fastify, { type FastifyBaseLogger, type FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import type { ClerkClient } from "@clerk/backend";
import { z } from "zod";

import { env } from "./env.js";
import clerkAuthPlugin, { requireAuth, getUserEmail } from "./clerk-auth.js";
import { inferSchema } from "./pipeline/schema-inference.js";
import { datasetContextSchema, type DatasetContext } from "./pipeline/populate.js";
import { populateWorkflow } from "./mastra/workflows/populate.js";
import { updateWorkflow } from "./mastra/workflows/update.js";
import { convex, api, internal } from "./convex.js";
import { sendTransactionalEmail } from "./email/send.js";
import { datasetReadyTemplate } from "./email/templates/dataset-ready.js";
import { capture, shutdown as shutdownAnalytics } from "./analytics/posthog.js";
import { EVENTS } from "./analytics/events.js";
import { registerDataset, deregisterDataset, abortDataset } from "./abort-registry.js";
import {
  LOCAL_USER_ID,
  clearLegacyPlaintextLocalCredentials,
  exchangeOpenRouterOAuthCode,
  getLocalSetupStatus,
  requireLocalSetupComplete,
  saveLocalCredential,
  verifyOpenRouterApiKey,
  verifyTinyFishApiKey,
} from "./local-credentials.js";

/** Domain part of an email, for analytics (we never log full addresses). */
function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "unknown";
}

type DatasetPopulateStatus = "building" | "live" | "failed";
type DatasetPopulateBeginOutcome =
  | "started"
  | "not_found"
  | "forbidden"
  | "already_building"
  | "already_updating";
type PopulateWorkflowRun = Awaited<ReturnType<typeof populateWorkflow.createRun>>;

type DatasetUpdateBeginOutcome =
  | "started"
  | "not_found"
  | "forbidden"
  | "already_building"
  | "already_updating";
type UpdateWorkflowRun = Awaited<ReturnType<typeof updateWorkflow.createRun>>;

const refreshCadenceSchema = z.enum(["manual", "30m", "6h", "12h", "daily", "weekly"]);
const cliCreateDatasetSchema = z.object({
  prompt: z.string().trim().min(1),
  maxRowCount: z.number().int().min(1).max(2500).default(100),
  refreshCadence: refreshCadenceSchema.default("manual"),
});
const cliDatasetIdParamsSchema = z.object({
  datasetId: z.string().min(1),
});

function cliDatasetNameFromSchemaName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapSchemaTypeToDatasetType(
  type: "string" | "url" | "date" | "number" | "boolean" | "enum",
): "text" | "number" | "boolean" | "url" | "date" {
  if (type === "url" || type === "date" || type === "number" || type === "boolean") {
    return type;
  }
  return "text";
}

function requireLocalCli(reply: FastifyReply): string | null {
  if (!env.IS_LOCAL_MODE) {
    void reply.code(404).send({ error: "Not found" });
    return null;
  }
  if (!env.CONVEX_ADMIN_KEY) {
    void reply.code(500).send({ error: "CONVEX_SELF_HOSTED_ADMIN_KEY is required" });
    return null;
  }
  return LOCAL_USER_ID;
}

function statusErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}

async function setDatasetPopulateStatus(
  datasetId: string,
  status: DatasetPopulateStatus,
  lastStatusError?: string,
): Promise<void> {
  await convex.mutation(internal.datasets.setStatusInternal, {
    id: datasetId,
    status,
    lastStatusError,
  });
}

async function beginDatasetPopulate(
  datasetId: string,
  ownerId: string,
): Promise<DatasetPopulateBeginOutcome> {
  const claim = await convex.mutation(internal.datasets.beginPopulateInternal, {
    id: datasetId,
    ownerId,
  });

  return claim.outcome;
}

async function sendDatasetReadyNotification({
  logger,
  clerk,
  userId,
  datasetId,
  datasetName,
  rowCount,
  workflowType = "populate",
}: {
  logger: FastifyBaseLogger;
  clerk: ClerkClient;
  userId: string;
  datasetId: string;
  datasetName: string;
  rowCount: number;
  workflowType?: "populate" | "update";
}): Promise<void> {
  if (env.IS_LOCAL_MODE) return;

  const baseProps = {
    datasetId,
    datasetName,
    rowCount,
    workflowType,
  };

  try {
    const email = await getUserEmail(clerk, userId);
    if (!email) {
      logger.warn(
        { userId },
        "No primary email on Clerk record; skipping dataset-ready notification",
      );
      capture({
        distinctId: userId,
        event: EVENTS.DATASET_READY_EMAIL_FAILED,
        properties: { ...baseProps, error_kind: "no_recipient" },
      });
      return;
    }

    try {
      await sendTransactionalEmail(
        email,
        datasetReadyTemplate({
          datasetName,
          rowCount,
          datasetUrl: `${env.CLIENT_ORIGIN}/dataset/${datasetId}`,
        }),
      );
      capture({
        distinctId: userId,
        event: EVENTS.DATASET_READY_EMAIL_SENT,
        properties: {
          ...baseProps,
          recipientDomain: emailDomain(email),
        },
      });
    } catch (sendErr) {
      logger.error(
        { err: sendErr, datasetId },
        "Failed to send dataset-ready email; populate already succeeded",
      );
      capture({
        distinctId: userId,
        event: EVENTS.DATASET_READY_EMAIL_FAILED,
        properties: { ...baseProps, error_kind: "send_failed" },
      });
    }
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr, datasetId },
      "Notify block crashed unexpectedly; populate already succeeded",
    );
  }
}

async function ensureLocalSetupReady(reply: FastifyReply): Promise<boolean> {
  try {
    await requireLocalSetupComplete();
    return true;
  } catch {
    await reply.code(428).send({
      error: "Local setup is incomplete. Connect TinyFish and OpenRouter first.",
    });
    return false;
  }
}

/**
 * Shared stop-success path: set the dataset live, send the ready email.
 *
 * Called by both background runners when the user presses Stop. Populate
 * only emails when at least one row was collected (a stopped run with 0
 * rows is live but empty). Update always emails regardless of count.
 */
async function finaliseRunAsLive({
  logger,
  clerk,
  datasetId,
  authorizedUserId,
  workflowType = "populate",
}: {
  logger: FastifyBaseLogger;
  clerk: ClerkClient;
  datasetId: string;
  authorizedUserId: string;
  workflowType?: "populate" | "update";
}): Promise<void> {
  const currentDataset = await convex.query(internal.datasets.getInternal, { id: datasetId });
  if (!currentDataset) return;

  await setDatasetPopulateStatus(datasetId, "live");

  const rowCount = await convex.query(internal.datasetRows.countByDataset, { datasetId });
  if (workflowType === "update" || rowCount > 0) {
    await sendDatasetReadyNotification({
      logger,
      clerk,
      userId: authorizedUserId,
      datasetId,
      datasetName: currentDataset.name,
      rowCount,
      workflowType,
    });
  }
}

async function beginDatasetUpdate(
  datasetId: string,
  ownerId: string,
): Promise<DatasetUpdateBeginOutcome> {
  const claim = await convex.mutation(internal.datasets.beginUpdateInternal, {
    id: datasetId,
    ownerId,
  });
  return claim.outcome;
}

async function runUpdateWorkflowInBackground({
  input,
  run,
  authorizedUserId,
  logger,
  clerk,
  modelConfig,
}: {
  input: DatasetContext;
  run: UpdateWorkflowRun;
  authorizedUserId: string;
  logger: FastifyBaseLogger;
  clerk: ClerkClient;
  modelConfig: {
    schemaInference: string;
    populateOrchestrator: string;
    investigateSubagent: string;
  };
}): Promise<void> {
  const datasetId = input.datasetId;
  // registerDataset is called by the route handler before void-ing this
  // function, so the registry entry is guaranteed visible the moment the
  // 202 response is sent. No call needed here.

  try {
    const result = await run.start({
      inputData: {
        ...input,
        authContext: {
          authorizedUserId,
          workflowRunId: run.runId,
          modelConfig,
        },
      },
    });

    logger.info(
      {
        workflowStatus: result.status,
        steps: JSON.stringify(result.steps).slice(0, 2000),
      },
      "Update workflow completed",
    );

    if (result.status !== "success") {
      throw new Error(`Workflow ended with status: ${result.status}`);
    }

    const currentDataset = await convex.query(internal.datasets.getInternal, {
      id: datasetId,
    });
    if (!currentDataset) {
      logger.info(
        { datasetId },
        "Dataset no longer exists post-update; skipping status transition",
      );
      return;
    }

    await setDatasetPopulateStatus(datasetId, "live");

    const rowCount = await convex.query(
      internal.datasetRows.countByDataset,
      { datasetId },
    );
    await sendDatasetReadyNotification({
      logger,
      clerk,
      userId: authorizedUserId,
      datasetId,
      datasetName: currentDataset.name,
      rowCount,
      workflowType: "update",
    });
  } catch (err) {
    // Note: a user-triggered stop is NOT handled here. The update workflow's
    // refreshRowsStep detects the abort internally, clears pending row
    // statuses, and returns normally — so run.start() returns { status:
    // "success" } and the success path above handles the live transition.
    // This catch only fires on genuine failures.
    const lastStatusError = statusErrorMessage(err);
    logger.error({ err, datasetId }, "Update background workflow failed");

    try {
      const currentDataset = await convex.query(internal.datasets.getInternal, {
        id: datasetId,
      });
      if (!currentDataset) {
        logger.info(
          { datasetId },
          "Dataset no longer exists after failed update; skipping failed status transition",
        );
        return;
      }
      await setDatasetPopulateStatus(datasetId, "failed", lastStatusError);
    } catch (statusErr) {
      logger.error(
        { err: statusErr, datasetId },
        "Failed to transition dataset status to 'failed' after update",
      );
    }
  } finally {
    deregisterDataset(datasetId);
  }
}

async function runScheduledUpdateWorkflowInBackground({
  input,
  run,
  authorizedUserId,
  logger,
  modelConfig,
}: {
  input: DatasetContext;
  run: UpdateWorkflowRun;
  authorizedUserId: string;
  logger: FastifyBaseLogger;
  modelConfig: {
    schemaInference: string;
    populateOrchestrator: string;
    investigateSubagent: string;
  };
}): Promise<void> {
  const datasetId = input.datasetId;
  registerDataset(datasetId);

  try {
    const result = await run.start({
      inputData: {
        ...input,
        authContext: {
          authorizedUserId,
          workflowRunId: run.runId,
          modelConfig,
        },
      },
    });

    logger.info(
      {
        datasetId,
        workflowStatus: result.status,
        steps: JSON.stringify(result.steps).slice(0, 2000),
      },
      "Scheduled update workflow completed",
    );

    if (result.status !== "success") {
      throw new Error(`Workflow ended with status: ${result.status}`);
    }

    await convex.mutation(internal.datasets.completeScheduledRefreshInternal, {
      id: datasetId,
      now: Date.now(),
    });
  } catch (err) {
    const lastStatusError = statusErrorMessage(err);
    logger.error({ err, datasetId }, "Scheduled update workflow failed");

    try {
      await convex.mutation(internal.datasets.failScheduledRefreshInternal, {
        id: datasetId,
        now: Date.now(),
        lastStatusError,
      });
    } catch (statusErr) {
      logger.error(
        { err: statusErr, datasetId },
        "Failed to record scheduled refresh failure",
      );
    }
  } finally {
    deregisterDataset(datasetId);
  }
}

async function runPopulateWorkflowInBackground({
  input,
  run,
  controller,
  authorizedUserId,
  logger,
  clerk,
  modelConfig,
}: {
  input: DatasetContext;
  run: PopulateWorkflowRun;
  controller: AbortController;
  authorizedUserId: string;
  logger: FastifyBaseLogger;
  clerk: ClerkClient;
  modelConfig: {
    schemaInference: string;
    populateOrchestrator: string;
    investigateSubagent: string;
  };
}): Promise<void> {
  const datasetId = input.datasetId;

  try {
    const result = await run.start({
      inputData: {
        ...input,
        authContext: {
          authorizedUserId,
          workflowRunId: run.runId,
          modelConfig,
        },
      },
    });

    logger.info(
      {
        workflowStatus: result.status,
        steps: JSON.stringify(result.steps).slice(0, 2000),
      },
      "Populate workflow completed",
    );

    if (result.status !== "success") {
      throw new Error(`Workflow ended with status: ${result.status}`);
    }

    const currentDataset = await convex.query(internal.datasets.getInternal, {
      id: datasetId,
    });
    if (!currentDataset) {
      logger.info(
        { datasetId },
        "Dataset no longer exists post-workflow; skipping status transition and notification",
      );
      return;
    }

    const rowCount = await convex.query(
      internal.datasetRows.countByDataset,
      { datasetId },
    );
    if (rowCount === 0) {
      throw new Error("Populate workflow completed with 0 rows");
    }

    await setDatasetPopulateStatus(datasetId, "live");
    await sendDatasetReadyNotification({
      logger,
      clerk,
      userId: authorizedUserId,
      datasetId,
      datasetName: currentDataset.name,
      rowCount,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      // User pressed Stop — treat whatever was collected as the final dataset.
      logger.info({ datasetId }, "Populate workflow stopped by user; transitioning to live");
      try {
        await finaliseRunAsLive({ logger, clerk, datasetId, authorizedUserId });
      } catch (stopErr) {
        logger.error({ err: stopErr, datasetId }, "Failed to finalise stopped populate run; marking as failed");
        // Ensure the dataset always leaves "building" — without this fallback,
        // a failed finalisation leaves the dataset with no active registry entry
        // and no way for /stop to act on it again.
        try {
          await setDatasetPopulateStatus(datasetId, "failed", "Workflow stopped but could not be finalised");
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr, datasetId }, "Could not update dataset status after stop finalisation failure");
        }
      }
      return;
    }

    const lastStatusError = statusErrorMessage(err);
    logger.error(
      { err, datasetId },
      "Populate background workflow failed",
    );

    try {
      const currentDataset = await convex.query(internal.datasets.getInternal, {
        id: datasetId,
      });
      if (!currentDataset) {
        logger.info(
          { datasetId },
          "Dataset no longer exists after failed populate; skipping failed status transition",
        );
        return;
      }

      await setDatasetPopulateStatus(datasetId, "failed", lastStatusError);
    } catch (statusErr) {
      logger.error(
        { err: statusErr, datasetId },
        "Failed to transition dataset status to 'failed'",
      );
    }
  } finally {
    deregisterDataset(datasetId);
  }
}

async function backfillDatasetRefreshSettings(
  logger: FastifyBaseLogger,
): Promise<void> {
  try {
    const result = await convex.mutation(
      internal.datasets.backfillRefreshSettings,
      { defaultCadence: "daily" },
    );
    logger.info(result, "Dataset refresh settings backfill complete");
  } catch (err) {
    logger.error({ err }, "Dataset refresh settings backfill failed");
    throw err;
  }
}

function startLocalRefreshScheduler(
  logger: FastifyBaseLogger,
): ReturnType<typeof setInterval> | null {
  if (!env.REFRESH_SCHEDULER_ENABLED) {
    logger.info("Dataset refresh scheduler disabled");
    return null;
  }

  let ticking = false;

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;

    try {
      if (env.IS_LOCAL_MODE) {
        const setup = await getLocalSetupStatus();
        if (!setup.complete) return;
      }

      const now = Date.now();
      const dueDatasets = await convex.query(
        internal.datasets.listDueForRefreshInternal,
        {
          now,
          limit: env.REFRESH_SCHEDULER_BATCH_SIZE,
        },
      );

      for (const dueDataset of dueDatasets as Array<{ _id: string }>) {
        let run: UpdateWorkflowRun;
        try {
          run = await updateWorkflow.createRun();
        } catch (runErr) {
          logger.error(runErr, "Failed to create scheduled update workflow run");
          continue;
        }

        const claim = await convex.mutation(
          internal.datasets.claimScheduledRefreshInternal,
          {
            id: dueDataset._id,
            now: Date.now(),
            runId: run.runId,
            staleAfterMs: env.REFRESH_SCHEDULER_STALE_AFTER_MS,
          },
        );

        if (claim.outcome !== "started") {
          logger.debug(
            { datasetId: dueDataset._id, outcome: claim.outcome },
            "Skipped scheduled refresh claim",
          );
          continue;
        }

        const dataset = claim.dataset;
        const { getModelConfig } = await import("./config/models.js");
        const modelConfig = await getModelConfig(dataset.ownerId);

        void runScheduledUpdateWorkflowInBackground({
          input: {
            datasetId: dataset.datasetId,
            datasetName: dataset.datasetName,
            description: dataset.description,
            maxRowCount: dataset.maxRowCount ?? 100,
            columns: dataset.columns,
          },
          run,
          authorizedUserId: dataset.ownerId,
          logger,
          modelConfig,
        });
      }
    } catch (err) {
      logger.error({ err }, "Dataset refresh scheduler tick failed");
    } finally {
      ticking = false;
    }
  }

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, env.REFRESH_SCHEDULER_POLL_MS);
  logger.info(
    {
      pollMs: env.REFRESH_SCHEDULER_POLL_MS,
      batchSize: env.REFRESH_SCHEDULER_BATCH_SIZE,
      staleAfterMs: env.REFRESH_SCHEDULER_STALE_AFTER_MS,
    },
    "Dataset refresh scheduler started",
  );
  return interval;
}

const fastify = Fastify({ logger: true });

const allowedCorsOrigins = new Set(env.CLIENT_ORIGINS);
if (env.IS_LOCAL_MODE) {
  for (const origin of env.CLIENT_ORIGINS) {
    try {
      const clientOrigin = new URL(origin);
      if (
        clientOrigin.hostname === "localhost" ||
        clientOrigin.hostname === "127.0.0.1"
      ) {
        allowedCorsOrigins.add(
          `${clientOrigin.protocol}//localhost${clientOrigin.port ? `:${clientOrigin.port}` : ""}`,
        );
        allowedCorsOrigins.add(
          `${clientOrigin.protocol}//127.0.0.1${clientOrigin.port ? `:${clientOrigin.port}` : ""}`,
        );
      }
    } catch {
      // Keep the configured origin only if the origin is not URL-shaped.
    }
  }
}

await fastify.register(fastifyCors, {
  origin: Array.from(allowedCorsOrigins),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  credentials: true,
  maxAge: 86400,
});

// Make `fastify.clerk` available and warn on missing CLERK_SECRET_KEY.
// `requireAuth` (also exported from ./clerk-auth) is the preHandler for
// protected routes — see the example block below.
await fastify.register(clerkAuthPlugin);

await clearLegacyPlaintextLocalCredentials().catch((err) => {
  fastify.log.warn({ err }, "Failed to clear legacy local credential plaintext");
});

await backfillDatasetRefreshSettings(fastify.log);
const refreshScheduler = startLocalRefreshScheduler(fastify.log);

// Flush queued PostHog events on graceful shutdown so a SIGTERM mid-flight
// doesn't drop the dataset_ready_email_sent capture from the last request.
fastify.addHook("onClose", async () => {
  if (refreshScheduler) clearInterval(refreshScheduler);
  await shutdownAnalytics();
});

// ────────────────────────────────────────────────────────────────────────
//  Public routes
// ────────────────────────────────────────────────────────────────────────

fastify.get("/health", async () => ({ status: "ok" }));

fastify.get("/share/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  reply.header("Access-Control-Allow-Origin", "*");
  let dataset;
  try {
    dataset = await convex.query(api.datasets.get, { id });
  } catch (err) {
    request.log.error({ err, id }, "Failed to fetch dataset for share route");
    return reply.code(502).send({ error: "Failed to fetch dataset" });
  }
  if (!dataset || dataset.visibility !== "public") {
    return reply.code(404).send({ error: "Dataset not found" });
  }
  return {
    name: dataset.name,
    description: dataset.description,
    rowCount: dataset.rowCount,
    columns: dataset.columns,
  };
});

fastify.options("/share/:id", async (_request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  return reply.code(204).send();
});

fastify.get("/local-setup/status", async (_req, reply) => {
  if (!env.IS_LOCAL_MODE) {
    return reply.code(404).send({ error: "Not found" });
  }
  return await getLocalSetupStatus();
});

fastify.post("/local-setup/tinyfish", async (req, reply) => {
  if (!env.IS_LOCAL_MODE) {
    return reply.code(404).send({ error: "Not found" });
  }

  const body = req.body as { apiKey?: string };
  const apiKey = body?.apiKey?.trim();
  if (!apiKey) {
    return reply.code(400).send({ error: "TinyFish API key is required" });
  }

  try {
    await verifyTinyFishApiKey(apiKey);
    await saveLocalCredential("tinyfish", apiKey, "api_key");
    return await getLocalSetupStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : "TinyFish verification failed";
    req.log.warn({ err }, "TinyFish local setup verification failed");
    return reply.code(400).send({ error: message });
  }
});

fastify.post("/local-setup/openrouter-key", async (req, reply) => {
  if (!env.IS_LOCAL_MODE) {
    return reply.code(404).send({ error: "Not found" });
  }

  const body = req.body as { apiKey?: string };
  const apiKey = body?.apiKey?.trim();
  if (!apiKey) {
    return reply.code(400).send({ error: "OpenRouter API key is required" });
  }

  try {
    await verifyOpenRouterApiKey(apiKey);
    await saveLocalCredential("openrouter", apiKey, "api_key");
    return await getLocalSetupStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenRouter verification failed";
    req.log.warn({ err }, "OpenRouter local setup verification failed");
    return reply.code(400).send({ error: message });
  }
});

fastify.post("/local-setup/openrouter-oauth", async (req, reply) => {
  if (!env.IS_LOCAL_MODE) {
    return reply.code(404).send({ error: "Not found" });
  }

  const body = req.body as { code?: string; codeVerifier?: string };
  const code = body?.code?.trim();
  const codeVerifier = body?.codeVerifier?.trim();
  if (!code || !codeVerifier) {
    return reply.code(400).send({ error: "OpenRouter OAuth code is required" });
  }

  try {
    const apiKey = await exchangeOpenRouterOAuthCode({ code, codeVerifier });
    await verifyOpenRouterApiKey(apiKey);
    await saveLocalCredential("openrouter", apiKey, "oauth");
    return await getLocalSetupStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenRouter OAuth failed";
    req.log.warn({ err }, "OpenRouter OAuth setup failed");
    return reply.code(400).send({ error: message });
  }
});


fastify.post("/openrouter/refresh", { preHandler: requireAuth }, async (req, reply) => {
  const { fetchModelsFromOpenRouter, upsertModelBatch } = await import("./config/models.js");
  try {
    const models = await fetchModelsFromOpenRouter();
    await upsertModelBatch(models);
    return { success: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh models";
    req.log.error(err, "OpenRouter refresh failed");
    return reply.code(500).send({ error: message });
  }
});

fastify.get("/openrouter/models", async (req, reply) => {
  const { getCachedModels } = await import("./config/models.js");
  try {
    const models = await getCachedModels();
    return { models };
  } catch (err) {
    req.log.error(err, "Failed to load cached models");
    return reply.code(500).send({ error: "Failed to load models" });
  }
});

// ────────────────────────────────────────────────────────────────────────
//  Local trusted CLI routes
// ────────────────────────────────────────────────────────────────────────

fastify.get("/cli/datasets", async (_req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;

  try {
    const datasets = await convex.query(internal.datasets.listByOwnerInternal, {
      ownerId,
    });
    return { datasets };
  } catch (err) {
    fastify.log.error(err, "CLI dataset list failed");
    return reply.code(502).send({ error: "Failed to list datasets" });
  }
});

fastify.post("/cli/datasets", async (req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;
  if (!(await ensureLocalSetupReady(reply))) return;

  const parsed = cliCreateDatasetSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid request",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const schema = await inferSchema(parsed.data.prompt);
    const columns = schema.columns.map((column) => ({
      name: column.name,
      type: mapSchemaTypeToDatasetType(column.type),
      description: column.retrieval_hint,
      isPrimaryKey: column.is_primary_key || undefined,
    }));

    const datasetId = await convex.mutation(
      internal.datasets.createForOwnerInternal,
      {
        ownerId,
        name: cliDatasetNameFromSchemaName(schema.dataset_name),
        description: parsed.data.prompt,
        refreshCadence: parsed.data.refreshCadence,
        maxRowCount: parsed.data.maxRowCount,
        columns,
        retrievalStrategy: schema.retrieval_strategy,
        sourceHint: schema.source_hint,
      },
    );

    const dataset = await convex.query(internal.datasets.getOwnedInternal, {
      id: datasetId,
      ownerId,
    });

    return reply.code(201).send({ dataset, schema });
  } catch (err) {
    req.log.error(err, "CLI dataset create failed");
    return reply.code(502).send({ error: "Failed to create dataset" });
  }
});

fastify.get("/cli/datasets/:datasetId", async (req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;

  const params = cliDatasetIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: "datasetId is required" });
  }

  try {
    const dataset = await convex.query(internal.datasets.getOwnedInternal, {
      id: params.data.datasetId,
      ownerId,
    });
    if (!dataset) return reply.code(404).send({ error: "Dataset not found" });
    return { dataset };
  } catch (err) {
    req.log.error(err, "CLI dataset get failed");
    return reply.code(400).send({ error: "Invalid datasetId" });
  }
});

fastify.get("/cli/datasets/:datasetId/rows", async (req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;

  const params = cliDatasetIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: "datasetId is required" });
  }

  try {
    const rows = await convex.query(
      internal.datasetRows.listByOwnedDatasetInternal,
      {
        datasetId: params.data.datasetId,
        ownerId,
      },
    );
    if (!rows) return reply.code(404).send({ error: "Dataset not found" });
    return { rows };
  } catch (err) {
    req.log.error(err, "CLI rows get failed");
    return reply.code(400).send({ error: "Invalid datasetId" });
  }
});

fastify.post("/cli/datasets/:datasetId/populate", async (req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;
  if (!(await ensureLocalSetupReady(reply))) return;

  const params = cliDatasetIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: "datasetId is required" });
  }

  let claimedDatasetId: string | null = null;
  try {
    const dataset = await convex.query(internal.datasets.getOwnedInternal, {
      id: params.data.datasetId,
      ownerId,
    });
    if (!dataset) return reply.code(404).send({ error: "Dataset not found" });

    const populateOutcome = await beginDatasetPopulate(dataset._id, ownerId);
    if (populateOutcome === "already_building") {
      return reply.code(409).send({ error: "Dataset is already being populated" });
    }
    if (populateOutcome === "already_updating") {
      return reply.code(409).send({ error: "Dataset is already being updated" });
    }
    if (populateOutcome !== "started") {
      return reply.code(409).send({ error: `Cannot populate dataset: ${populateOutcome}` });
    }
    claimedDatasetId = dataset._id;

    const { getModelConfig } = await import("./config/models.js");
    const modelConfig = await getModelConfig(ownerId);
    const run = await populateWorkflow.createRun();
    const controller = registerDataset(dataset._id);

    void runPopulateWorkflowInBackground({
      input: {
        datasetId: dataset._id,
        datasetName: dataset.name,
        description: dataset.description,
        maxRowCount: dataset.maxRowCount ?? 100,
        columns: dataset.columns,
      },
      run,
      controller,
      authorizedUserId: ownerId,
      logger: req.log,
      clerk: req.server.clerk,
      modelConfig,
    });

    return reply.code(202).send({ success: true, runId: run.runId });
  } catch (err) {
    req.log.error(err, "CLI populate failed");
    if (claimedDatasetId) {
      try {
        await setDatasetPopulateStatus(
          claimedDatasetId,
          "failed",
          statusErrorMessage(err),
        );
      } catch (statusErr) {
        req.log.error(
          { err: statusErr, datasetId: claimedDatasetId },
          "Failed to release CLI populate dataset claim",
        );
      }
    }
    return reply.code(502).send({ error: "Failed to populate dataset" });
  }
});

fastify.post("/cli/datasets/:datasetId/stop", async (req, reply) => {
  const ownerId = requireLocalCli(reply);
  if (!ownerId) return;

  const params = cliDatasetIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    return reply.code(400).send({ error: "datasetId is required" });
  }

  try {
    const dataset = await convex.query(internal.datasets.getOwnedInternal, {
      id: params.data.datasetId,
      ownerId,
    });
    if (!dataset) return reply.code(404).send({ error: "Dataset not found" });
    if (dataset.status !== "building" && dataset.status !== "updating") {
      return reply.code(409).send({ error: "Dataset is not currently running" });
    }

    const aborted = abortDataset(dataset._id);
    if (!aborted) {
      req.log.warn(
        { datasetId: dataset._id },
        "CLI stop requested for orphaned dataset (no active run registered); forcing to failed",
      );
      try {
        if (dataset.status === "updating") {
          await convex.mutation(internal.datasetRows.clearAllPendingUpdateStatus, {
            datasetId: dataset._id,
          });
        }
        await setDatasetPopulateStatus(
          dataset._id,
          "failed",
          "Run interrupted: no active local CLI run registered",
        );
      } catch (statusErr) {
        req.log.error(
          { err: statusErr, datasetId: dataset._id },
          "Failed to force-transition orphaned CLI dataset to failed",
        );
      }
      return reply.code(200).send({ success: true });
    }
    return reply.code(202).send({ success: true });
  } catch (err) {
    req.log.error(err, "CLI stop failed");
    return reply.code(502).send({ error: "Failed to stop dataset run" });
  }
});

// ────────────────────────────────────────────────────────────────────────
//  Protected routes — gated by Clerk JWT verification
// ────────────────────────────────────────────────────────────────────────

await fastify.register(async (instance) => {
  instance.addHook("preHandler", requireAuth);

  instance.get("/settings/models", async (req) => {
    const { getModelConfig } = await import("./config/models.js");
    const config = await getModelConfig(req.auth!.userId);
    return { config };
  });

  instance.post("/settings/models", async (req, reply) => {
    const { upsertModelConfig, validateModelSlug, getCachedModels } = await import("./config/models.js");
    const body = req.body as {
      schemaInference?: string | null;
      populateOrchestrator?: string | null;
      investigateSubagent?: string | null;
    };

    const toValidate: Array<{ role: "schemaInference" | "populateOrchestrator" | "investigateSubagent"; slug: string }> = [];
    if (body.schemaInference) toValidate.push({ role: "schemaInference", slug: body.schemaInference });
    if (body.populateOrchestrator) toValidate.push({ role: "populateOrchestrator", slug: body.populateOrchestrator });
    if (body.investigateSubagent) toValidate.push({ role: "investigateSubagent", slug: body.investigateSubagent });

    if (toValidate.length > 0) {
      try {
        const models = await getCachedModels();
        for (const { role, slug } of toValidate) {
          const found = models.some((m) => m.canonicalSlug === slug);
          if (!found) {
            return reply.code(400).send({
              error: `Invalid model slug "${slug}" for ${role}. Refresh the model list first or choose a different model.`,
            });
          }
        }
      } catch (err) {
        req.log.error(err, "Failed to validate model slugs — allowing save");
      }
    }

    try {
      await upsertModelConfig(req.auth!.userId, {
        schemaInference: body.schemaInference ?? undefined,
        populateOrchestrator: body.populateOrchestrator ?? undefined,
        investigateSubagent: body.investigateSubagent ?? undefined,
      });
      return { success: true };
    } catch (err) {
      req.log.error(err, "Failed to save model config");
      return reply.code(500).send({ error: "Failed to save model preferences" });
    }
  });

  instance.post("/infer-schema", async (req, reply) => {
    const body = req.body as { prompt?: string; modelSlug?: string };
    if (!body?.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }
    if (!(await ensureLocalSetupReady(reply))) return;

    try {
      const auth = req.auth;
      let modelSlug = body.modelSlug;

      if (!modelSlug && auth) {
        const { getModelConfig } = await import("./config/models.js");
        const config = await getModelConfig(auth.userId);
        if (config?.schemaInference) {
          modelSlug = config.schemaInference;
        }
      }

      const schema = await inferSchema(body.prompt.trim(), modelSlug);
      return schema;
    } catch (err) {
      req.log.error(err, "Schema inference failed");
      return reply.code(502).send({ error: "Schema inference failed. Please try again." });
    }
  });

  instance.post("/populate", async (req, reply) => {
    const parsed = datasetContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (!(await ensureLocalSetupReady(reply))) return;

    try {
      const auth = req.auth;
      if (!auth) {
        return reply.code(401).send({ error: "Authentication required" });
      }

      const populateOutcome = await beginDatasetPopulate(
        parsed.data.datasetId,
        auth.userId,
      );

      if (populateOutcome === "not_found") {
        return reply.code(404).send({ error: "Dataset not found" });
      }
      if (populateOutcome === "forbidden") {
        return reply.code(403).send({ error: "Not authorized to populate this dataset" });
      }
      if (populateOutcome === "already_building") {
        return reply.code(409).send({ error: "Dataset is already being populated" });
      }
      if (populateOutcome !== "started") {
        throw new Error(`Unexpected populate claim outcome: ${populateOutcome}`);
      }

      const dataset = await convex.query(internal.datasets.getInternal, {
        id: parsed.data.datasetId,
      });
      if (!dataset) {
        return reply.code(404).send({ error: "Dataset not found" });
      }

      const { getModelConfig } = await import("./config/models.js");
      const modelConfig = await getModelConfig(auth.userId);

      let run: Awaited<ReturnType<typeof populateWorkflow.createRun>>;
      try {
        run = await populateWorkflow.createRun();
      } catch (runErr) {
        req.log.error(runErr, "Failed to create workflow run; releasing dataset claim");
        await setDatasetPopulateStatus(parsed.data.datasetId, "failed", statusErrorMessage(runErr));
        return reply.code(502).send({ error: "Failed to populate dataset. Please try again." });
      }

      // Register before void-ing so the abort-registry entry is visible the
      // instant the 202 is sent, closing the TOCTOU window where a /stop
      // arriving before registerDataset runs inside the background function
      // would incorrectly force-transition an active run to "failed".
      const controller = registerDataset(parsed.data.datasetId);

      void runPopulateWorkflowInBackground({
        input: {
          ...parsed.data,
          maxRowCount: dataset.maxRowCount ?? parsed.data.maxRowCount,
        },
        run,
        controller,
        authorizedUserId: auth.userId,
        logger: req.log,
        clerk: req.server.clerk,
        modelConfig,
      });

      return reply.code(202).send({ success: true, runId: run.runId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("validator") || msg.includes("Invalid")) {
        return reply.code(400).send({ error: "Invalid datasetId" });
      }
      req.log.error(err, "Populate failed");
      return reply.code(502).send({ error: "Failed to populate dataset. Please try again." });
    }
  });

  instance.post("/update", async (req, reply) => {
    const parsed = datasetContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (!(await ensureLocalSetupReady(reply))) return;

    try {
      const auth = req.auth;
      if (!auth) {
        return reply.code(401).send({ error: "Authentication required" });
      }

      const updateOutcome = await beginDatasetUpdate(
        parsed.data.datasetId,
        auth.userId,
      );

      if (updateOutcome === "not_found") {
        return reply.code(404).send({ error: "Dataset not found" });
      }
      if (updateOutcome === "forbidden") {
        return reply.code(403).send({ error: "Not authorized to update this dataset" });
      }
      if (updateOutcome === "already_building") {
        return reply.code(409).send({ error: "Dataset is being populated" });
      }
      if (updateOutcome === "already_updating") {
        return reply.code(409).send({ error: "Dataset is already being updated" });
      }
      if (updateOutcome !== "started") {
        throw new Error(`Unexpected update claim outcome: ${updateOutcome}`);
      }

      let run: UpdateWorkflowRun;
      try {
        run = await updateWorkflow.createRun();
      } catch (runErr) {
        req.log.error(runErr, "Failed to create update workflow run; reverting dataset status");
        await setDatasetPopulateStatus(parsed.data.datasetId, "live");
        return reply.code(502).send({ error: "Failed to update dataset. Please try again." });
      }

      const { getModelConfig } = await import("./config/models.js");
      const modelConfig = await getModelConfig(auth.userId);

      // Register before void-ing so the abort-registry entry is visible the
      // instant the 202 is sent, closing the TOCTOU window where a /stop
      // arriving before registerDataset runs inside the background function
      // would incorrectly force-transition an active run to "failed".
      registerDataset(parsed.data.datasetId);

      void runUpdateWorkflowInBackground({
        input: parsed.data,
        run,
        authorizedUserId: auth.userId,
        logger: req.log,
        clerk: req.server.clerk,
        modelConfig,
      });

      return reply.code(202).send({ success: true, runId: run.runId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("validator") || msg.includes("Invalid")) {
        return reply.code(400).send({ error: "Invalid datasetId" });
      }
      req.log.error(err, "Update failed");
      return reply.code(502).send({ error: "Failed to update dataset. Please try again." });
    }
  });

  instance.post("/stop", async (req, reply) => {
    const body = req.body as { datasetId?: string };
    if (!body?.datasetId || typeof body.datasetId !== "string") {
      return reply.code(400).send({ error: "datasetId is required" });
    }

    const auth = req.auth;
    if (!auth) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    try {
      const dataset = await convex.query(internal.datasets.getInternal, {
        id: body.datasetId,
      });
      if (!dataset) {
        return reply.code(404).send({ error: "Dataset not found" });
      }
      if (dataset.ownerId !== auth.userId) {
        return reply.code(403).send({ error: "Not authorized to stop this dataset" });
      }
      if (dataset.status !== "building" && dataset.status !== "updating") {
        return reply.code(409).send({ error: "Dataset is not currently running" });
      }

      const aborted = abortDataset(body.datasetId);
      if (!aborted) {
        // No registered signal despite the dataset being "building"/"updating".
        // The normal finish path always sets a terminal status in Convex
        // *before* calling deregisterDataset(), so if the status is still
        // busy here, no running process owns this dataset — it was orphaned
        // by a server restart. Force-transition to "failed" so the dataset
        // is no longer stuck.
        req.log.warn(
          { datasetId: body.datasetId },
          "Stop requested for orphaned dataset (no active run registered); forcing to failed",
        );
        try {
          if (dataset.status === "updating") {
            await convex.mutation(internal.datasetRows.clearAllPendingUpdateStatus, {
              datasetId: body.datasetId,
            });
          }
          await setDatasetPopulateStatus(
            body.datasetId,
            "failed",
            "Run interrupted: server restarted while building/updating",
          );
        } catch (statusErr) {
          req.log.error(
            { err: statusErr, datasetId: body.datasetId },
            "Failed to force-transition orphaned dataset to failed",
          );
        }
        return reply.code(200).send({ success: true });
      }
      req.log.info({ datasetId: body.datasetId }, "Stop requested");

      return reply.code(202).send({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("validator") || msg.includes("Invalid")) {
        return reply.code(400).send({ error: "Invalid datasetId" });
      }
      req.log.error(err, "Stop failed");
      return reply.code(502).send({ error: "Failed to stop dataset run. Please try again." });
    }
  });
});

try {
  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
