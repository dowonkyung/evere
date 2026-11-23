import { createClient } from "npm:@supabase/supabase-js@2.80.0";

const origin = "https://evere.saevit.online";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (body: object, status = 200) => Response.json(body, { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply({ error: "Authentication required" }, 401);
  const { data: owner } = await client.from("evere_members").select("role")
    .eq("id", user.id).is("removed_at", null).maybeSingle();
  if (owner?.role !== "owner") return reply({ error: "Owner access required" }, 403);

  const body = await request.json().catch(() => null);
  if (typeof body?.target !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.target)) {
    return reply({ error: "Invalid account" }, 400);
  }
  const { data: member } = await client.from("evere_members").select("id")
    .eq("id", body.target).is("removed_at", null).maybeSingle();
  if (!member) return reply({ error: "Member not found" }, 404);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: account } = await admin.auth.admin.getUserById(member.id);
  if (!account?.user?.email) return reply({ error: "Member not found" }, 404);
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: account.user.email });
  if (error || !data.properties.hashed_token) return reply({ error: "Recovery link unavailable" }, 502);
  const link = new URL("/account/reset/", origin);
  link.hash = new URLSearchParams({ token: data.properties.hashed_token }).toString();
  return reply({ link: link.href });
});
