import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGatewayHandler } from "./handler.mjs";

Deno.serve(createGatewayHandler({ createClient, env: Deno.env }));
