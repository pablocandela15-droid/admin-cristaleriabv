import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BarraGuardar } from "@/components/web/contenido/BarraGuardar";
import { useGuardarContenido } from "@/hooks/useWebContenido";
import { limpiarNegocio, telefonoEnlace, type NegocioWeb } from "@/lib/web/contenido";

const aNegocio = (v: unknown): NegocioWeb => (v && typeof v === "object" && !Array.isArray(v) ? (JSON.parse(JSON.stringify(v)) as NegocioWeb) : {});

function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

/** Datos del negocio que enseña la web: lema, descripción, teléfonos, WhatsApp, correo, dirección, horario y zona. */
export function FormNegocio({ valor, puedeEditar }: { valor: unknown; puedeEditar: boolean }) {
  const guardar = useGuardarContenido();
  const original = useMemo(() => aNegocio(valor), [valor]);
  const [n, setN] = useState<NegocioWeb>(original);
  useEffect(() => setN(original), [original]);
  const cambios = JSON.stringify(limpiarNegocio(n)) !== JSON.stringify(limpiarNegocio(original));
  const set = <K extends keyof NegocioWeb>(k: K, v: NegocioWeb[K]) => setN((x) => ({ ...x, [k]: v }));
  const dis = !puedeEditar;
  const email = (n.email ?? "").trim();
  const error = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "El correo no es válido." : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Presentación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Campo id="neg-tagline" etiqueta="Lema">
            <Input id="neg-tagline" value={n.tagline ?? ""} maxLength={120} disabled={dis} onChange={(e) => set("tagline", e.target.value)} />
          </Campo>
          <Campo id="neg-anios" etiqueta="Años de experiencia">
            <Input
              id="neg-anios"
              type="number"
              min={1}
              max={200}
              value={n.yearsExperience ?? ""}
              disabled={dis}
              onChange={(e) => set("yearsExperience", e.target.value === "" ? undefined : Number(e.target.value))}
              className="w-28"
            />
          </Campo>
          <div className="sm:col-span-2">
            <Campo id="neg-desc" etiqueta="Descripción" ayuda="La frase que sale en los buscadores y al compartir la web.">
              <Textarea id="neg-desc" value={n.description ?? ""} maxLength={400} rows={3} disabled={dis} onChange={(e) => set("description", e.target.value)} />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo id="neg-zona" etiqueta="Zona de trabajo">
              <Textarea id="neg-zona" value={n.serviceArea ?? ""} maxLength={400} rows={2} disabled={dis} onChange={(e) => set("serviceArea", e.target.value)} />
            </Campo>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contacto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Teléfonos</Label>
            {(n.phones ?? []).map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  value={p.label}
                  placeholder="Oficina"
                  aria-label={`Nombre del teléfono ${i + 1}`}
                  maxLength={40}
                  disabled={dis}
                  className="w-40"
                  onChange={(e) => set("phones", (n.phones ?? []).map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <Input
                  value={p.display}
                  placeholder="650 06 63 23"
                  aria-label={`Número del teléfono ${i + 1}`}
                  maxLength={30}
                  disabled={dis}
                  className="w-44"
                  onChange={(e) =>
                    set("phones", (n.phones ?? []).map((x, j) => (j === i ? { ...x, display: e.target.value, tel: telefonoEnlace(e.target.value) } : x)))
                  }
                />
                <span className="text-xs text-muted-foreground">{p.tel || telefonoEnlace(p.display)}</span>
                {!dis && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Quitar el teléfono ${i + 1}`} onClick={() => set("phones", (n.phones ?? []).filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {!dis && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => set("phones", [...(n.phones ?? []), { label: "", display: "", tel: "" }])}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Añadir teléfono
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="neg-wa" etiqueta="WhatsApp" ayuda="Con el prefijo del país y sin espacios: 34650066323.">
              <Input id="neg-wa" value={n.whatsapp ?? ""} maxLength={20} disabled={dis} onChange={(e) => set("whatsapp", e.target.value.replace(/[^\d]/g, ""))} />
            </Campo>
            <Campo id="neg-email" etiqueta="Correo electrónico">
              <Input id="neg-email" type="email" value={n.email ?? ""} maxLength={200} disabled={dis} onChange={(e) => set("email", e.target.value)} aria-invalid={!!error} />
            </Campo>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dirección y horario</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["street", "Calle y número"],
                ["postalCode", "Código postal"],
                ["city", "Población"],
                ["province", "Provincia"],
                ["country", "País"],
              ] as const
            ).map(([k, etiqueta]) => (
              <Campo key={k} id={`neg-${k}`} etiqueta={etiqueta}>
                <Input
                  id={`neg-${k}`}
                  value={n.address?.[k] ?? ""}
                  maxLength={120}
                  disabled={dis}
                  onChange={(e) => set("address", { ...(n.address ?? {}), [k]: e.target.value })}
                />
              </Campo>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Horario</Label>
            {(n.hours ?? []).map((h, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  value={h.days}
                  placeholder="Lunes a viernes"
                  aria-label={`Días ${i + 1}`}
                  maxLength={60}
                  disabled={dis}
                  className="w-48"
                  onChange={(e) => set("hours", (n.hours ?? []).map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))}
                />
                <Input
                  value={h.time}
                  placeholder="9:00 – 13:30 y 16:00 – 19:30"
                  aria-label={`Horas ${i + 1}`}
                  maxLength={80}
                  disabled={dis}
                  className="min-w-0 flex-1 sm:max-w-sm"
                  onChange={(e) => set("hours", (n.hours ?? []).map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                />
                {!dis && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Quitar el horario ${i + 1}`} onClick={() => set("hours", (n.hours ?? []).filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {!dis && (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => set("hours", [...(n.hours ?? []), { days: "", time: "" }])}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Añadir horario
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <BarraGuardar
        puedeEditar={puedeEditar}
        cambios={cambios}
        guardando={guardar.isPending}
        error={error}
        onDescartar={() => setN(original)}
        onGuardar={() => guardar.mutate({ clave: "negocio", valor: limpiarNegocio(n) })}
        texto="Guardar datos del negocio"
      />
    </div>
  );
}
