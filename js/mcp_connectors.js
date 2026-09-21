"use strict";

let _mcpLastCredential = null;

async function mcpInvoke(action, teamId, input = {}) {
  if (!teamId) throw new Error("Escolhe primeiro um workspace remoto.");
  const client = await RemoteWorkspace.init();
  if (!client) throw new Error("Supabase não está configurado.");
  const { data, error } = await client.functions.invoke("vision-coach-connectors", {
    body: { action, team_id: teamId, ...input },
  });
  if (error) throw new Error(error.message || "Não foi possível contactar o gestor de conectores.");
  if (!data?.ok) throw new Error(data?.error || "Operação MCP falhou.");
  return data;
}

const MCPConnectors = {
  async list(teamId) {
    return mcpInvoke("list", teamId);
  },

  async create(teamId, input) {
    const data = await mcpInvoke("create", teamId, {
      label: input?.label,
      scopes: Array.isArray(input?.scopes) ? input.scopes : ["read"],
      expires_in_days: Number(input?.expires_in_days || 365),
    });
    _mcpLastCredential = {
      token: data.token,
      mcp_url: data.mcp_url,
      connector: data.connector,
      warning: data.warning,
    };
    return data;
  },

  async revoke(teamId, tokenId) {
    return mcpInvoke("revoke", teamId, { token_id: tokenId });
  },

  lastCredential() {
    return _mcpLastCredential;
  },

  clearCredential() {
    _mcpLastCredential = null;
  },
};

if (typeof globalThis !== "undefined") globalThis.MCPConnectors = MCPConnectors;
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MCPConnectors };
}
