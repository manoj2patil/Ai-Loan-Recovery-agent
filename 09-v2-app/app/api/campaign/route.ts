// GET  /api/campaign — campaigns with live stats.
// POST /api/campaign — { action: "start", name, filters:{bucket|product|language}, limit }
//                      { action: "next", campaignId } → dial next compliant borrower

import { NextResponse } from "next/server";
import { startCampaign, nextCall, listCampaigns } from "@/lib/campaign";
import { requireRole, HttpError } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  return NextResponse.json({ campaigns: listCampaigns() });
}

export async function POST(req: Request) {
  try {
    const actor = requireRole(req, "officer");
    const body = await req.json();

    if (body.action === "start") {
      const campaign = await startCampaign({ name: body.name || "campaign", filters: body.filters ?? {}, limit: body.limit });
      writeAudit({ actor: actor.name, role: actor.role, action: "CAMPAIGN_START",
        entity: "Campaign", entityId: campaign.id,
        details: { filters: campaign.filters, queued: campaign.queue.length, gatedOut: campaign.gatedOut } });
      return NextResponse.json({ ok: true, campaign: { id: campaign.id, queued: campaign.queue.length, gatedOut: campaign.gatedOut, status: campaign.status } });
    }

    if (body.action === "next") {
      const res = await nextCall(body.campaignId);
      return NextResponse.json({ ok: true, ...res });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
