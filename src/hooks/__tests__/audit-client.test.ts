import { describe, expect, it, vi } from "vitest";
import { ADMITE_INTEGRACION, clienteConAuditoria, conAuditoriaDePeticion } from "../../../supabase/functions/_shared/audit-client";

function doble() {
  const requests: Headers[] = [];
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Headers(init?.headers));
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", transport);
  const rpc = vi.fn().mockResolvedValue({ data: "event-1", error: null });
  const factory = vi.fn((_url: string, _key: string, options?: { global?: { headers?: Record<string,string>; fetch?: typeof fetch } }) => ({
    write: () => (options?.global?.fetch ?? transport)("https://db.test/rest/v1/peticiones", {
      headers: { Authorization: "Bearer server-key", ...options?.global?.headers },
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    rpc,
  }));
  return { requests, transport, rpc, factory };
}

const request = (token: string, extra: Record<string,string> = {}) => new Request("https://edge.test/admin-set-super-admin", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, ...extra },
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe("identidad de las funciones del servidor", () => {
  it("dos peticiones simultáneas conservan su autor con un cliente compartido", async () => {
    const d = doble();
    const shared = clienteConAuditoria(d.factory, "admin-set-super-admin")("https://db.test", "key");
    const a = gate(), b = gate();
    const handler = conAuditoriaDePeticion("admin-set-super-admin", d.factory, async req => {
      const token = req.headers.get("Authorization")!;
      await shared.write();
      if (token.endsWith("A")) { a.resolve(); await b.promise; }
      else { b.resolve(); await a.promise; }
      await shared.write();
      return new Response("{}");
    }, async token => ({ id: `user-${token}`, email: `${token}@test.local` }));
    await Promise.all([handler(request("A")), handler(request("B"))]);
    expect(d.requests.map(h => h.get("x-audit-actor-id")).sort()).toEqual(["user-A","user-A","user-B","user-B"]);
    const requestIds = new Map<string,Set<string>>();
    for (const h of d.requests) {
      const actor = h.get("x-audit-actor-id")!;
      const ids = requestIds.get(actor) ?? new Set();
      ids.add(h.get("x-audit-request-id")!); requestIds.set(actor,ids);
      expect(h.get("Authorization")).toBe("Bearer server-key");
    }
    expect(requestIds.get("user-A")?.size).toBe(1);
    expect(requestIds.get("user-B")?.size).toBe(1);
    expect([...requestIds.get("user-A")!]).not.toEqual([...requestIds.get("user-B")!]);
  });

  it("ignora las cabeceras de identidad aportadas por el llamante", async () => {
    const d = doble();
    const client = clienteConAuditoria(d.factory,"admin-set-super-admin")("url","key");
    const handler = conAuditoriaDePeticion("admin-set-super-admin",d.factory,async () => {
      await client.write(); return new Response("{}");
    }, async () => ({ id:"verified-user" }));
    await handler(request("token", { "x-audit-actor-id":"victim", "x-audit-source":"fake" }));
    expect(d.requests[0].get("x-audit-actor-id")).toBe("verified-user");
    expect(d.requests[0].get("x-audit-source")).toBe("admin-set-super-admin");
  });

  it("no ejecuta una acción de usuario si Auth rechaza el token", async () => {
    const d = doble(), ejecutar = vi.fn(async () => new Response("{}"));
    const handler = conAuditoriaDePeticion("analizar-peticion", d.factory, ejecutar);
    const response = await handler(request("invalid-user-token"));
    expect(response.status).toBe(401);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(d.rpc).not.toHaveBeenCalled();
    expect((await response.json()).error).toContain("La acción no se ha ejecutado");
  });

  it("un fallo de conexión al verificar el autor detiene la acción antes del efecto", async () => {
    const d = doble(), ejecutar = vi.fn(async () => new Response("{}"));
    const handler = conAuditoriaDePeticion("analizar-peticion", d.factory, ejecutar, async () => {
      throw new Error("Auth unavailable");
    });
    expect((await handler(request("user-token"))).status).toBe(503);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it("la delegación a otra función conserva al usuario del JWT original", async () => {
    const a = doble(), b = doble();
    // Una petición urgente que avisa por Telegram: el aviso lo firma quien escribió la petición.
    const clientB = clienteConAuditoria(b.factory,"avisos-telegram")("url","key");
    const avisar = conAuditoriaDePeticion("avisos-telegram",b.factory,async () => {
      await clientB.write(); return new Response("{}");
    },async token => token === "original-user" ? {id:"original-actor"} : null);
    const peticion = conAuditoriaDePeticion("analizar-peticion",a.factory,async req => avisar(new Request("https://edge.test/avisos-telegram/pendientes", {
      method:"POST",headers:{Authorization:req.headers.get("Authorization")!},
    })),async () => ({id:"original-actor"}));
    await peticion(request("original-user"));
    expect(b.requests[0].get("x-audit-actor-id")).toBe("original-actor");
    expect(b.requests[0].get("x-audit-source")).toBe("avisos-telegram");
    expect(a.rpc).toHaveBeenCalled(); expect(b.rpc).toHaveBeenCalled();
  });

  it("una tarea en segundo plano conserva el iniciador tras terminar el handler", async () => {
    const d = doble(), release = gate();
    const client = clienteConAuditoria(d.factory,"admin-set-super-admin")("url","key");
    let task!: Promise<unknown>;
    const handler=conAuditoriaDePeticion("admin-set-super-admin",d.factory,async () => {
      task=(async () => { await release.promise; return client.write(); })();
      return new Response("{}");
    },async () => ({ id:"initiator" }));
    await handler(request("token")); release.resolve(); await task;
    expect(d.requests[0].get("x-audit-actor-id")).toBe("initiator");
    await client.write();
    expect(d.requests[1].get("x-audit-actor-id")).toBeNull();
    expect(d.requests[1].get("x-audit-source")).toBe("admin-set-super-admin");
  });

  it("la prueba de Telegram se registra tras terminar, sin guardar el cuerpo", async () => {
    const d = doble();
    const handler=conAuditoriaDePeticion("avisos-telegram",d.factory,async () => new Response(JSON.stringify({ ok:true, password:"private" }), {
      headers:{"Content-Type":"application/json"},
    }),async () => ({ id:"sender" }));
    await handler(new Request("https://edge.test/avisos-telegram/probar", {method:"POST",headers:{Authorization:"Bearer token"},body:JSON.stringify({password:"private"})}));
    expect(d.rpc).toHaveBeenCalledWith("registrar_accion_auditoria_panel", {
      p_operacion:"avisos-telegram/probar",p_detalles:{resultado:"completada",codigo_http:200},
    });
    expect(JSON.stringify(d.rpc.mock.calls)).not.toContain("private");
  });

  it("una respuesta de negocio fallida no se presenta como éxito", async () => {
    const d = doble();
    const handler=conAuditoriaDePeticion("analizar-peticion",d.factory,async () => new Response('{"success":false}', {
      headers:{"Content-Type":"application/json"},
    }),async () => ({ id:"sender" }));
    await handler(request("token"));
    expect(d.rpc.mock.calls[0][1].p_detalles.resultado).toBe("fallida");
  });

  it("si falla el registro, avisa de que la acción puede estar aplicada antes de repetir", async () => {
    const d = doble(); d.rpc.mockResolvedValue({error:{message:"write failed"}});
    const handler=conAuditoriaDePeticion("analizar-peticion",d.factory,async () => new Response("{}"),async () => ({id:"sender"}));
    const response=await handler(request("token"));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("Revisa el resultado antes de repetirla");
  });

  it("el preflight no consulta usuarios ni genera un evento", async () => {
    const d = doble(), resolve=vi.fn();
    const handler=conAuditoriaDePeticion("analizar-peticion",d.factory,async () => new Response(null,{status:204}),resolve);
    expect((await handler(new Request("https://edge.test/analizar-peticion",{method:"OPTIONS"}))).status).toBe(204);
    expect(resolve).not.toHaveBeenCalled(); expect(d.rpc).not.toHaveBeenCalled();
  });
});

it('un endpoint del panel no ejecuta acciones sin usuario verificado', async () => {
  const d=doble(), run=vi.fn(async () => new Response('{}'));
  const handler=conAuditoriaDePeticion('control-excel',d.factory,run);
  const response=await handler(new Request('https://edge.test/control-excel',{method:'POST'}));
  expect(response.status).toBe(401); expect(run).not.toHaveBeenCalled();
});
it('las integraciones con autenticación propia conservan su validación y no confunden publishable key con un usuario', async () => {
  // avisos-telegram: pg_cron con x-ocr-secret o un super admin; lo comprueba su handler.
  const d=doble(), run=vi.fn(async () => new Response('{}'));
  const handler=conAuditoriaDePeticion('avisos-telegram',d.factory,run);
  expect((await handler(request('sb_publishable_public-key'))).status).toBe(200);
  expect(run).toHaveBeenCalled(); expect(d.rpc).not.toHaveBeenCalled();
});
it('una función del panel fuera de ADMITE_INTEGRACION no se ejecuta con la publishable key', async () => {
  const d=doble(), run=vi.fn(async () => new Response('{}'));
  expect(ADMITE_INTEGRACION.has('servicios-uso')).toBe(false);
  const handler=conAuditoriaDePeticion('servicios-uso',d.factory,run);
  expect((await handler(request('sb_publishable_public-key'))).status).toBe(401);
  expect(run).not.toHaveBeenCalled(); expect(d.rpc).not.toHaveBeenCalled();
});
it('las funciones de solo lectura no generan evento si van bien, pero sí si fallan', async () => {
  const bien=doble();
  await conAuditoriaDePeticion('servicios-uso',bien.factory,async () => new Response('{}'),async () => ({id:'verified'}))(request('jwt'));
  expect(bien.rpc).not.toHaveBeenCalled();
  const mal=doble();
  await conAuditoriaDePeticion('servicios-uso',mal.factory,async () => new Response('{}',{status:502}),async () => ({id:'verified'}))(request('jwt'));
  expect(mal.rpc).toHaveBeenCalledWith('registrar_accion_auditoria_panel',{p_operacion:'servicios-uso',p_detalles:{resultado:'fallida',codigo_http:502}});
});
it('la función conserva navegador y dispositivo del iniciador sin aceptar un actor enviado por el navegador', async () => {
  const d=doble(), client=clienteConAuditoria(d.factory,'control-excel')('url','key');
  const handler=conAuditoriaDePeticion('control-excel',d.factory,async()=>{ await client.write(); return new Response('{}'); },async()=>({id:'verified'}));
  await handler(request('jwt',{'user-agent':'iPhone Safari','x-client-info':'adminpanel/phone-1/req-1','x-audit-actor-id':'other'}));
  expect(d.requests[0].get('x-audit-user-agent')).toBe('iPhone Safari');
  expect(d.requests[0].get('x-audit-device-id')).toBe('phone-1');
  expect(d.requests[0].get('x-audit-actor-id')).toBe('verified');
});
