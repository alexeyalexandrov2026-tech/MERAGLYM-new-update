import { AdapterRegistry } from "../../MERAGLYM-main/src/lib/adapters/registry";

interface Env {
  DB: D1Database;
  FSSP_API_KEY?: string;
  OPENCTI_URL?: string;
  OPENCTI_TOKEN?: string;
  SPIDERFOOT_SERVER_URL?: string;
  DADATA_API_KEY?: string;
  NUMVERIFY_API_KEY?: string;
  [key: string]: unknown;
}

export default {
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      const { jobId, type } = msg.body;
      
      try {
        // Fetch job from D1
        const jobRow = await env.DB.prepare("SELECT * FROM Job WHERE id = ?").bind(jobId).first();
        if (!jobRow) {
          console.warn(`Job ${jobId} not found in DB`);
          msg.ack();
          continue;
        }

        // Set to RUNNING
        await env.DB.prepare("UPDATE Job SET status = 'RUNNING', startedAt = ?, updatedAt = ? WHERE id = ?")
          .bind(new Date().toISOString(), new Date().toISOString(), jobId).run();

        // Find adapter
        const adapter = AdapterRegistry.get(type);
        if (!adapter) {
          await env.DB.prepare("UPDATE Job SET status = 'FAILED', error = ?, completedAt = ?, updatedAt = ? WHERE id = ?")
            .bind(JSON.stringify({ code: "ADAPTER_NOT_FOUND", message: `Adapter ${type} not found` }), new Date().toISOString(), new Date().toISOString(), jobId).run();
          msg.ack();
          continue;
        }

        const payload = jobRow.payload ? JSON.parse(jobRow.payload as string) : {};

        try {
          // Execute adapter
          const result = await adapter.execute(payload, { env, requestId: jobId });
          
          if (result.success) {
            await env.DB.prepare("UPDATE Job SET status = 'COMPLETED', result = ?, completedAt = ?, updatedAt = ? WHERE id = ?")
              .bind(JSON.stringify(result), new Date().toISOString(), new Date().toISOString(), jobId).run();
          } else {
            await env.DB.prepare("UPDATE Job SET status = 'FAILED', error = ?, completedAt = ?, updatedAt = ? WHERE id = ?")
              .bind(JSON.stringify(result.error), new Date().toISOString(), new Date().toISOString(), jobId).run();
          }
        } catch (err) {
          console.error(`Error executing adapter ${type} for job ${jobId}`, err);
          await env.DB.prepare("UPDATE Job SET status = 'FAILED', error = ?, completedAt = ?, updatedAt = ? WHERE id = ?")
            .bind(JSON.stringify({ code: "ADAPTER_ERROR", message: err instanceof Error ? err.message : String(err) }), new Date().toISOString(), new Date().toISOString(), jobId).run();
        }

        msg.ack();
      } catch (globalErr) {
        console.error(`Failed to process message ${msg.id}`, globalErr);
        msg.retry();
      }
    }
  },
  
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/simulate-queue") {
      const body = await request.json() as any;
      const fakeBatch = {
        messages: [
          {
            id: "fake-msg-1",
            body: body,
            ack: () => console.log("ACK"),
            retry: () => console.log("RETRY")
          }
        ]
      } as any;
      await this.queue(fakeBatch, env, ctx);
      return new Response("Simulated queue execution", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  }
};
