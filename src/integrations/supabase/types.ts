export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// Generado a partir de supabase/migrations/20261118120000_nucleo_panel.sql (esquema público del núcleo).
// Para regenerarlo con la CLI: npx supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts
export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_feature_toggles: {
        Row: {
          id: string
          section_key: string
          label: string
          enabled: boolean
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          section_key: string
          label: string
          enabled?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          section_key?: string
          label?: string
          enabled?: boolean
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_auth_context: {
        Row: {
          id: string
          actor_user_id: string
          actor_email: string | null
          operacion: string
          subject_user_id: string | null
          subject_email: string | null
          expires_at: string
          user_agent: string | null
          device_id: string | null
          ip_address: string | null
          request_id: string | null
        }
        Insert: {
          id?: string
          actor_user_id: string
          actor_email?: string | null
          operacion: string
          subject_user_id?: string | null
          subject_email?: string | null
          expires_at?: string
          user_agent?: string | null
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
        }
        Update: {
          id?: string
          actor_user_id?: string
          actor_email?: string | null
          operacion?: string
          subject_user_id?: string | null
          subject_email?: string | null
          expires_at?: string
          user_agent?: string | null
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          created_at: string
          actor_user_id: string | null
          actor_email: string | null
          accion: string
          tabla: string | null
          registro_id: string | null
          detalles: Json | null
          user_agent: string | null
          actor_label: string
          actor_origin: string
          device_id: string | null
          ip_address: string | null
          request_id: string | null
          session_id: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          actor_user_id?: string | null
          actor_email?: string | null
          accion?: string
          tabla?: string | null
          registro_id?: string | null
          detalles?: Json | null
          user_agent?: string | null
          actor_label?: string
          actor_origin?: string
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
          session_id?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          actor_user_id?: string | null
          actor_email?: string | null
          accion?: string
          tabla?: string | null
          registro_id?: string | null
          detalles?: Json | null
          user_agent?: string | null
          actor_label?: string
          actor_origin?: string
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      avisos_telegram_config: {
        Row: {
          id: boolean
          activo: boolean
          chat_id: string | null
          hora_resumen: number
          tipos_al_momento: string[]
          silencio_activo: boolean
          silencio_desde: number
          silencio_hasta: number
          activo_desde: string | null
          resumen_ultimo_dia: string | null
          updated_at: string
          updated_by: string | null
          tope_hora: number
          tope_dia: number
        }
        Insert: {
          id?: boolean
          activo?: boolean
          chat_id?: string | null
          hora_resumen?: number
          tipos_al_momento?: string[]
          silencio_activo?: boolean
          silencio_desde?: number
          silencio_hasta?: number
          activo_desde?: string | null
          resumen_ultimo_dia?: string | null
          updated_at?: string
          updated_by?: string | null
          tope_hora?: number
          tope_dia?: number
        }
        Update: {
          id?: boolean
          activo?: boolean
          chat_id?: string | null
          hora_resumen?: number
          tipos_al_momento?: string[]
          silencio_activo?: boolean
          silencio_desde?: number
          silencio_hasta?: number
          activo_desde?: string | null
          resumen_ultimo_dia?: string | null
          updated_at?: string
          updated_by?: string | null
          tope_hora?: number
          tope_dia?: number
        }
        Relationships: []
      }
      avisos_telegram_envios: {
        Row: {
          id: number
          tipo: string
          aviso_id: string | null
          chat_id: string | null
          enviado_en: string
          ok: boolean
          error: string | null
          mensaje_id: number | null
          fallo_id: number | null
        }
        Insert: {
          id?: number
          tipo: string
          aviso_id?: string | null
          chat_id?: string | null
          enviado_en?: string
          ok: boolean
          error?: string | null
          mensaje_id?: number | null
          fallo_id?: number | null
        }
        Update: {
          id?: number
          tipo?: string
          aviso_id?: string | null
          chat_id?: string | null
          enviado_en?: string
          ok?: boolean
          error?: string | null
          mensaje_id?: number | null
          fallo_id?: number | null
        }
        Relationships: []
      }
      costes_fijos: {
        Row: {
          id: string
          concepto: string
          proveedor: string
          categoria: string
          eur_mes: number | null
          naturaleza: string
          notas: string | null
          verificado_en: string | null
          activo: boolean
          orden: number
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id?: string
          concepto: string
          proveedor: string
          categoria: string
          eur_mes?: number | null
          naturaleza: string
          notas?: string | null
          verificado_en?: string | null
          activo?: boolean
          orden?: number
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          concepto?: string
          proveedor?: string
          categoria?: string
          eur_mes?: number | null
          naturaleza?: string
          notas?: string | null
          verificado_en?: string | null
          activo?: boolean
          orden?: number
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      fallos_internos: {
        Row: {
          id: number
          tipo: string
          datos: Json
          usuario_id: string | null
          usuario: string | null
          clave: string | null
          created_at: string
          intentos: number
          reclamado_en: string | null
          enviado_en: string | null
          ultimo_error: string | null
        }
        Insert: {
          id?: number
          tipo?: string
          datos?: Json
          usuario_id?: string | null
          usuario?: string | null
          clave?: string | null
          created_at?: string
          intentos?: number
          reclamado_en?: string | null
          enviado_en?: string | null
          ultimo_error?: string | null
        }
        Update: {
          id?: number
          tipo?: string
          datos?: Json
          usuario_id?: string | null
          usuario?: string | null
          clave?: string | null
          created_at?: string
          intentos?: number
          reclamado_en?: string | null
          enviado_en?: string | null
          ultimo_error?: string | null
        }
        Relationships: []
      }
      ia_coste_estimado: {
        Row: {
          funcion: string
          unidad: string
          usd_por_unidad: number
          unidades_mes_estimadas: number
          modelo: string | null
          medido_en: string | null
          nota: string | null
        }
        Insert: {
          funcion: string
          unidad?: string
          usd_por_unidad: number
          unidades_mes_estimadas: number
          modelo?: string | null
          medido_en?: string | null
          nota?: string | null
        }
        Update: {
          funcion?: string
          unidad?: string
          usd_por_unidad?: number
          unidades_mes_estimadas?: number
          modelo?: string | null
          medido_en?: string | null
          nota?: string | null
        }
        Relationships: []
      }
      ia_funciones: {
        Row: {
          funcion: string
          descripcion: string
          instrumentada: boolean
          unidad: string
          orden: number
          activo: boolean
          que_hace: string | null
          accion: string | null
        }
        Insert: {
          funcion: string
          descripcion: string
          instrumentada?: boolean
          unidad?: string
          orden?: number
          activo?: boolean
          que_hace?: string | null
          accion?: string | null
        }
        Update: {
          funcion?: string
          descripcion?: string
          instrumentada?: boolean
          unidad?: string
          orden?: number
          activo?: boolean
          que_hace?: string | null
          accion?: string | null
        }
        Relationships: []
      }
      ia_modelo_funcion: {
        Row: {
          funcion: string
          modelo: string | null
          modelo_respaldo: string | null
          modelo_codigo: string | null
          centralizado: boolean
          notas: string | null
          cambiado_por: string | null
          cambiado_por_email: string | null
          cambiado_en: string
          usa_herramientas: boolean
        }
        Insert: {
          funcion?: string
          modelo?: string | null
          modelo_respaldo?: string | null
          modelo_codigo?: string | null
          centralizado?: boolean
          notas?: string | null
          cambiado_por?: string | null
          cambiado_por_email?: string | null
          cambiado_en?: string
          usa_herramientas?: boolean
        }
        Update: {
          funcion?: string
          modelo?: string | null
          modelo_respaldo?: string | null
          modelo_codigo?: string | null
          centralizado?: boolean
          notas?: string | null
          cambiado_por?: string | null
          cambiado_por_email?: string | null
          cambiado_en?: string
          usa_herramientas?: boolean
        }
        Relationships: []
      }
      ia_modelo_funcion_historial: {
        Row: {
          id: number
          funcion: string
          modelo_anterior: string | null
          modelo_nuevo: string | null
          respaldo_anterior: string | null
          respaldo_nuevo: string | null
          notas: string | null
          cambiado_por: string | null
          cambiado_por_email: string | null
          cambiado_en: string
        }
        Insert: {
          id?: number
          funcion: string
          modelo_anterior?: string | null
          modelo_nuevo?: string | null
          respaldo_anterior?: string | null
          respaldo_nuevo?: string | null
          notas?: string | null
          cambiado_por?: string | null
          cambiado_por_email?: string | null
          cambiado_en?: string
        }
        Update: {
          id?: number
          funcion?: string
          modelo_anterior?: string | null
          modelo_nuevo?: string | null
          respaldo_anterior?: string | null
          respaldo_nuevo?: string | null
          notas?: string | null
          cambiado_por?: string | null
          cambiado_por_email?: string | null
          cambiado_en?: string
        }
        Relationships: []
      }
      ia_modelos_disponibles: {
        Row: {
          id: string
          owned_by: string | null
          creado_openai: string | null
          primera_vez_visto: string
          ultima_vez_visto: string
          retirado_en: string | null
          primera_carga: boolean
          de_interes: boolean | null
          compatible_herramientas: boolean | null
          compatible_motivo: string | null
          compatible_probado_en: string | null
        }
        Insert: {
          id: string
          owned_by?: string | null
          creado_openai?: string | null
          primera_vez_visto?: string
          ultima_vez_visto?: string
          retirado_en?: string | null
          primera_carga?: boolean
          de_interes?: never
          compatible_herramientas?: boolean | null
          compatible_motivo?: string | null
          compatible_probado_en?: string | null
        }
        Update: {
          id?: string
          owned_by?: string | null
          creado_openai?: string | null
          primera_vez_visto?: string
          ultima_vez_visto?: string
          retirado_en?: string | null
          primera_carga?: boolean
          de_interes?: never
          compatible_herramientas?: boolean | null
          compatible_motivo?: string | null
          compatible_probado_en?: string | null
        }
        Relationships: []
      }
      ia_precios: {
        Row: {
          modelo: string
          usd_por_m_input: number
          usd_por_m_cached: number | null
          usd_por_m_cache_write: number | null
          usd_por_m_output: number
          razonamiento_como_output: boolean
          notas: string | null
          fuente: string | null
          verificado_en: string | null
          actualizado_en: string
        }
        Insert: {
          modelo: string
          usd_por_m_input: number
          usd_por_m_cached?: number | null
          usd_por_m_cache_write?: number | null
          usd_por_m_output: number
          razonamiento_como_output?: boolean
          notas?: string | null
          fuente?: string | null
          verificado_en?: string | null
          actualizado_en?: string
        }
        Update: {
          modelo?: string
          usd_por_m_input?: number
          usd_por_m_cached?: number | null
          usd_por_m_cache_write?: number | null
          usd_por_m_output?: number
          razonamiento_como_output?: boolean
          notas?: string | null
          fuente?: string | null
          verificado_en?: string | null
          actualizado_en?: string
        }
        Relationships: []
      }
      ia_uso: {
        Row: {
          id: number
          funcion: string
          operacion: string
          modelo: string
          prompt_tokens: number
          cached_tokens: number
          cache_write_tokens: number
          completion_tokens: number
          razonamiento_tokens: number
          llamadas: number
          coste_usd: number | null
          estado: string
          disparador: string | null
          duracion_ms: number | null
          created_at: string
        }
        Insert: {
          id?: number
          funcion: string
          operacion?: string
          modelo: string
          prompt_tokens?: number
          cached_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          razonamiento_tokens?: number
          llamadas?: number
          coste_usd?: number | null
          estado?: string
          disparador?: string | null
          duracion_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          funcion?: string
          operacion?: string
          modelo?: string
          prompt_tokens?: number
          cached_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          razonamiento_tokens?: number
          llamadas?: number
          coste_usd?: number | null
          estado?: string
          disparador?: string | null
          duracion_ms?: number | null
          created_at?: string
        }
        Relationships: []
      }
      notificaciones_dashboard: {
        Row: {
          id: string
          tipo: string
          titulo: string
          mensaje: string | null
          referencia_id: string | null
          referencia_tipo: string | null
          leida: boolean
          created_at: string | null
          origen: string | null
          prioridad: string
          clave: string | null
          caduca_en: string | null
          datos: Json | null
        }
        Insert: {
          id?: string
          tipo: string
          titulo: string
          mensaje?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          leida?: boolean
          created_at?: string | null
          origen?: string | null
          prioridad?: string
          clave?: string | null
          caduca_en?: string | null
          datos?: Json | null
        }
        Update: {
          id?: string
          tipo?: string
          titulo?: string
          mensaje?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          leida?: boolean
          created_at?: string | null
          origen?: string | null
          prioridad?: string
          clave?: string | null
          caduca_en?: string | null
          datos?: Json | null
        }
        Relationships: []
      }
      oficiososia_borradores: {
        Row: {
          id: string
          numero: string
          documento: Json
          factura_id: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id: string
          numero: string
          documento: Json
          factura_id?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          documento?: Json
          factura_id?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      oficiososia_facturacion_config: {
        Row: {
          id: boolean
          documento: Json
          actualizado_en: string
        }
        Insert: {
          id?: boolean
          documento: Json
          actualizado_en?: string
        }
        Update: {
          id?: boolean
          documento?: Json
          actualizado_en?: string
        }
        Relationships: []
      }
      oficiososia_facturas: {
        Row: {
          id: string
          numero: string
          documento: Json
          creado_por: string | null
          creado_en: string
          actualizado_en: string
        }
        Insert: {
          id: string
          numero: string
          documento: Json
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Update: {
          id?: string
          numero?: string
          documento?: Json
          creado_por?: string | null
          creado_en?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      openai_claves: {
        Row: {
          api_key_id: string
          project_id: string
          nombre: string | null
          proceso: string
          creado_en: string
        }
        Insert: {
          api_key_id: string
          project_id: string
          nombre?: string | null
          proceso?: string
          creado_en?: string
        }
        Update: {
          api_key_id?: string
          project_id?: string
          nombre?: string | null
          proceso?: string
          creado_en?: string
        }
        Relationships: []
      }
      openai_costes_diarios: {
        Row: {
          fecha: string
          project_id: string
          line_item: string
          usd: number
          actualizado_en: string
        }
        Insert: {
          fecha: string
          project_id?: string
          line_item?: string
          usd: number
          actualizado_en?: string
        }
        Update: {
          fecha?: string
          project_id?: string
          line_item?: string
          usd?: number
          actualizado_en?: string
        }
        Relationships: []
      }
      openai_proyectos: {
        Row: {
          project_id: string
          proceso: string | null
          nombre: string | null
          creado_en: string
        }
        Insert: {
          project_id: string
          proceso?: string | null
          nombre?: string | null
          creado_en?: string
        }
        Update: {
          project_id?: string
          proceso?: string | null
          nombre?: string | null
          creado_en?: string
        }
        Relationships: []
      }
      openai_uso_diario: {
        Row: {
          fecha: string
          project_id: string
          api_key_id: string
          modelo: string
          input_tokens: number
          cached_tokens: number
          output_tokens: number
          peticiones: number
          actualizado_en: string
        }
        Insert: {
          fecha: string
          project_id?: string
          api_key_id?: string
          modelo?: string
          input_tokens?: number
          cached_tokens?: number
          output_tokens?: number
          peticiones?: number
          actualizado_en?: string
        }
        Update: {
          fecha?: string
          project_id?: string
          api_key_id?: string
          modelo?: string
          input_tokens?: number
          cached_tokens?: number
          output_tokens?: number
          peticiones?: number
          actualizado_en?: string
        }
        Relationships: []
      }
      peticiones: {
        Row: {
          id: string
          creado_por: string | null
          creado_por_nombre: string | null
          creado_por_email: string | null
          titulo: string
          prioridad: string
          modulo: string
          descripcion: string
          captura_path: string | null
          ruta: string | null
          dispositivo: string | null
          estado: string
          motivo_descarte: string | null
          estado_cambiado_por: string | null
          estado_cambiado_en: string | null
          analisis: Json | null
          analisis_estado: string
          analisis_error: string | null
          analisis_modelo: string | null
          analisis_intentos: number
          analisis_pedido_en: string | null
          analizado_en: string | null
          linear_id: string | null
          linear_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          creado_por?: string | null
          creado_por_nombre?: string | null
          creado_por_email?: string | null
          titulo?: string
          prioridad?: string
          modulo?: string
          descripcion?: string
          captura_path?: string | null
          ruta?: string | null
          dispositivo?: string | null
          estado?: string
          motivo_descarte?: string | null
          estado_cambiado_por?: string | null
          estado_cambiado_en?: string | null
          analisis?: Json | null
          analisis_estado?: string
          analisis_error?: string | null
          analisis_modelo?: string | null
          analisis_intentos?: number
          analisis_pedido_en?: string | null
          analizado_en?: string | null
          linear_id?: string | null
          linear_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          creado_por?: string | null
          creado_por_nombre?: string | null
          creado_por_email?: string | null
          titulo?: string
          prioridad?: string
          modulo?: string
          descripcion?: string
          captura_path?: string | null
          ruta?: string | null
          dispositivo?: string | null
          estado?: string
          motivo_descarte?: string | null
          estado_cambiado_por?: string | null
          estado_cambiado_en?: string | null
          analisis?: Json | null
          analisis_estado?: string
          analisis_error?: string | null
          analisis_modelo?: string | null
          analisis_intentos?: number
          analisis_pedido_en?: string | null
          analizado_en?: string | null
          linear_id?: string | null
          linear_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      servicios_config: {
        Row: {
          id: boolean
          eur_por_usd: number
          actualizado_en: string
          actualizado_por: string | null
          tope_ia_mes_eur: number
        }
        Insert: {
          id?: boolean
          eur_por_usd?: number
          actualizado_en?: string
          actualizado_por?: string | null
          tope_ia_mes_eur?: number
        }
        Update: {
          id?: boolean
          eur_por_usd?: number
          actualizado_en?: string
          actualizado_por?: string | null
          tope_ia_mes_eur?: number
        }
        Relationships: []
      }
      servicios_contratados: {
        Row: {
          proveedor: string
          nombre: string
          plan: string | null
          precio_mensual: number | null
          moneda: string
          ciclo: string
          renovacion: string | null
          cuenta: string | null
          panel_url: string | null
          limites: Json
          notas: string | null
          actualizado_en: string
          actualizado_por: string | null
          categoria: string
          orden: number
          activo: boolean
          por_confirmar: boolean
          precio_anual: number | null
          fuente_precio: string | null
          para_que: string | null
          precio_confirmado_en: string | null
          plan_siguiente: string | null
          precio_siguiente: number | null
          si_se_pasa: string | null
        }
        Insert: {
          proveedor: string
          nombre: string
          plan?: string | null
          precio_mensual?: number | null
          moneda?: string
          ciclo?: string
          renovacion?: string | null
          cuenta?: string | null
          panel_url?: string | null
          limites?: Json
          notas?: string | null
          actualizado_en?: string
          actualizado_por?: string | null
          categoria?: string
          orden?: number
          activo?: boolean
          por_confirmar?: boolean
          precio_anual?: number | null
          fuente_precio?: string | null
          para_que?: string | null
          precio_confirmado_en?: string | null
          plan_siguiente?: string | null
          precio_siguiente?: number | null
          si_se_pasa?: string | null
        }
        Update: {
          proveedor?: string
          nombre?: string
          plan?: string | null
          precio_mensual?: number | null
          moneda?: string
          ciclo?: string
          renovacion?: string | null
          cuenta?: string | null
          panel_url?: string | null
          limites?: Json
          notas?: string | null
          actualizado_en?: string
          actualizado_por?: string | null
          categoria?: string
          orden?: number
          activo?: boolean
          por_confirmar?: boolean
          precio_anual?: number | null
          fuente_precio?: string | null
          para_que?: string | null
          precio_confirmado_en?: string | null
          plan_siguiente?: string | null
          precio_siguiente?: number | null
          si_se_pasa?: string | null
        }
        Relationships: []
      }
      servicios_contratados_copia_cierre: {
        Row: {
          proveedor: string
          fila: Json
          copiado_en: string
        }
        Insert: {
          proveedor: string
          fila: Json
          copiado_en?: string
        }
        Update: {
          proveedor?: string
          fila?: Json
          copiado_en?: string
        }
        Relationships: []
      }
      servicios_costes_mes: {
        Row: {
          proveedor: string
          mes: string
          importe: number
          moneda: string
          nota: string | null
          actualizado_en: string
          actualizado_por: string | null
        }
        Insert: {
          proveedor?: string
          mes?: string
          importe?: number
          moneda?: string
          nota?: string | null
          actualizado_en?: string
          actualizado_por?: string | null
        }
        Update: {
          proveedor?: string
          mes?: string
          importe?: number
          moneda?: string
          nota?: string | null
          actualizado_en?: string
          actualizado_por?: string | null
        }
        Relationships: []
      }
      servicios_uso: {
        Row: {
          id: string
          proveedor: string
          tomado_en: string
          metricas: Json
          error: string | null
          detalles: Json
          coste_variable: Json | null
        }
        Insert: {
          id?: string
          proveedor: string
          tomado_en?: string
          metricas?: Json
          error?: string | null
          detalles?: Json
          coste_variable?: Json | null
        }
        Update: {
          id?: string
          proveedor?: string
          tomado_en?: string
          metricas?: Json
          error?: string | null
          detalles?: Json
          coste_variable?: Json | null
        }
        Relationships: []
      }
      super_admins: {
        Row: {
          id: string
          user_id: string | null
          email: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          email: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          email?: string
          created_at?: string | null
        }
        Relationships: []
      }
      tipo_cambio_usd_eur: {
        Row: {
          fecha: string
          eur_por_usd: number
          fuente: string
          actualizado_en: string
        }
        Insert: {
          fecha: string
          eur_por_usd: number
          fuente?: string
          actualizado_en?: string
        }
        Update: {
          fecha?: string
          eur_por_usd?: number
          fuente?: string
          actualizado_en?: string
        }
        Relationships: []
      }
      user_access_status: {
        Row: {
          user_id: string
          access_blocked: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          access_blocked: boolean
          updated_at?: string
        }
        Update: {
          user_id?: string
          access_blocked?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          id: string
          user_id: string
          section_key: string
          can_view: boolean | null
          can_edit: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          section_key: string
          can_view?: boolean | null
          can_edit?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          section_key?: string
          can_view?: boolean | null
          can_edit?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_role_presets: {
        Row: {
          id: string
          name: string
          base_role: Database["public"]["Enums"]["app_role"]
          permissions: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          base_role?: Database["public"]["Enums"]["app_role"]
          permissions?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          base_role?: Database["public"]["Enums"]["app_role"]
          permissions?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: Database["public"]["Enums"]["app_role"]
          created_at: string | null
          seccion_inicio: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role?: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          seccion_inicio?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          created_at?: string | null
          seccion_inicio?: string | null
        }
        Relationships: []
      }
      web_linear_prueba: {
        Row: {
          id: number
          creado_en: string
          incidencia_id: number | null
          operacion: string
          linear_uuid: string | null
          titulo: string | null
          cuerpo: string | null
          prioridad: number | null
          etiquetas: string[]
        }
        Insert: {
          id?: number
          creado_en?: string
          incidencia_id?: number | null
          operacion: string
          linear_uuid?: string | null
          titulo?: string | null
          cuerpo?: string | null
          prioridad?: number | null
          etiquetas?: string[]
        }
        Update: {
          id?: number
          creado_en?: string
          incidencia_id?: number | null
          operacion?: string
          linear_uuid?: string | null
          titulo?: string | null
          cuerpo?: string | null
          prioridad?: number | null
          etiquetas?: string[]
        }
        Relationships: []
      }
      web_logs_config: {
        Row: {
          id: boolean
          linear_modo: string
          linear_equipo_id: string | null
          linear_proyecto_id: string | null
          linear_etiquetas: string[]
          actualizado_en: string
          actualizado_por: string | null
        }
        Insert: {
          id?: boolean
          linear_modo?: string
          linear_equipo_id?: string | null
          linear_proyecto_id?: string | null
          linear_etiquetas?: string[]
          actualizado_en?: string
          actualizado_por?: string | null
        }
        Update: {
          id?: boolean
          linear_modo?: string
          linear_equipo_id?: string | null
          linear_proyecto_id?: string | null
          linear_etiquetas?: string[]
          actualizado_en?: string
          actualizado_por?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      audit_log_visible: {
        Row: {
          id: string | null
          created_at: string | null
          actor_user_id: string | null
          actor_email: string | null
          accion: string | null
          tabla: string | null
          registro_id: string | null
          detalles: Json | null
          user_agent: string | null
          actor_label: string | null
          actor_origin: string | null
          device_id: string | null
          ip_address: string | null
          request_id: string | null
          session_id: string | null
          tipo_evento: string | null
          resultado: string | null
          visible_por_defecto: boolean | null
          texto_busqueda: string | null
        }
        Relationships: []
      }
      ia_uso_diario: {
        Row: {
          dia: string | null
          funcion: string | null
          modelo: string | null
          llamadas: number | null
          peticiones: number | null
          errores: number | null
          prompt_tokens: number | null
          cached_tokens: number | null
          completion_tokens: number | null
          razonamiento_tokens: number | null
          coste_usd: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      audit_tabla_util: {
        Args: {
            p_tabla: string
          }
        Returns: boolean
      }
      avisos_telegram_disparar: {
        Args: {
            p_accion: string
          }
        Returns: string
      }
      avisos_telegram_en_silencio: {
        Args: {
            p_hora: number
            p_desde: number
            p_hasta: number
          }
        Returns: boolean
      }
      avisos_telegram_hay_pendientes: {
        Args: never
        Returns: boolean
      }
      can_edit_section: {
        Args: {
            _section: string
          }
        Returns: boolean
      }
      can_read_section: {
        Args: {
            _section: string
          }
        Returns: boolean
      }
      can_write_section: {
        Args: {
            _section: string
          }
        Returns: boolean
      }
      establecer_superadmin_panel: {
        Args: {
            p_user_id: string
            p_make_super_admin: boolean
            p_email: string
          }
        Returns: undefined
      }
      fallo_interno_registrar: {
        Args: {
            p_tipo: string
            p_datos?: Json
            p_usuario_id?: string
            p_clave?: string
          }
        Returns: number
      }
      fallos_internos_desde: {
        Args: never
        Returns: string
      }
      fallos_internos_reclamar: {
        Args: {
            p_limite?: number
          }
        Returns: unknown[]
      }
      fijar_tope_ia_mes: {
        Args: {
            p_eur: number
          }
        Returns: number
      }
      finalizar_cambio_contrasena: {
        Args: {
            p_id: string
            p_actor: string
            p_resultado: string
          }
        Returns: undefined
      }
      finalizar_intento_panel: {
        Args: {
            p_id: string
            p_actor?: string
            p_resultado?: string
            p_session_id?: string
          }
        Returns: undefined
      }
      fn_audit_estado_permiso: {
        Args: {
            p_fila: Json
            p_referencia: Json
          }
        Returns: Json
      }
      fn_audit_sanitizar: {
        Args: {
            p_dato: Json
          }
        Returns: Json
      }
      gasto_ia_real_resumen: {
        Args: {
            p_dias?: number
          }
        Returns: {
            proceso: string
            usd_real: number
            ultimo_dia_real: string
            usd_estimado_hoy: number
            reparto: string
          }[]
      }
      get_user_role: {
        Args: {
            _user_id: string
          }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_section_permission: {
        Args: {
            _user_id: string
            _section: string
            _permission: string
          }
        Returns: boolean
      }
      ia_coste_alternativa: {
        Args: {
            p_modelo_alternativo: string
            p_desde?: string
            p_hasta?: string
          }
        Returns: {
            modelo_real: string
            modelo_alternativo: string
            peticiones: number
            coste_real_usd: number
            coste_alternativo_usd: number
            diferencia_usd: number
            diferencia_pct: number
          }[]
      }
      ia_coste_mes: {
        Args: never
        Returns: {
            mes: string
            coste_acumulado_usd: number
            peticiones: number
            dias_con_dato: number
            dias_mes: number
            dias_restantes: number
            usd_medio_dia: number
            proy_lineal_usd: number
            proy_media7_usd: number
            fijos_eur_mes: number
            fijos_sin_verificar: number
            estimado_ia_usd_mes: number
          }[]
      }
      ia_coste_por_funcion: {
        Args: {
            p_desde?: string
            p_hasta?: string
          }
        Returns: {
            funcion: string
            descripcion: string
            instrumentada: boolean
            llamadas: number
            peticiones: number
            errores: number
            prompt_tokens: number
            completion_tokens: number
            razonamiento_tokens: number
            coste_usd: number
            pct: number
            usd_por_peticion: number
          }[]
      }
      ia_coste_por_modelo: {
        Args: {
            p_desde?: string
            p_hasta?: string
          }
        Returns: {
            modelo: string
            llamadas: number
            peticiones: number
            prompt_tokens: number
            cached_tokens: number
            completion_tokens: number
            razonamiento_tokens: number
            pct_razonamiento: number
            coste_usd: number
            pct: number
            usd_por_peticion: number
            tarifado: boolean
          }[]
      }
      ia_coste_por_uso: {
        Args: {
            p_desde: string
            p_hasta: string
          }
        Returns: {
            funcion: string
            que_hace: string
            accion: string
            unidad: string
            orden: number
            llamadas: number
            usos: number
            usos_con_coste: number
            coste_usd: number
            filas_sin_tarifa: number
            modelos_sin_tarifa: string[]
            mediana_usd: number
            media_usd: number
            servidor_propio: boolean
          }[]
      }
      ia_coste_serie: {
        Args: {
            p_desde?: string
            p_hasta?: string
            p_funcion?: string
          }
        Returns: {
            dia: string
            coste_usd: number
            llamadas: number
            peticiones: number
            errores: number
            prompt_tokens: number
            completion_tokens: number
            razonamiento_tokens: number
            media_7: number
            media_30: number
            desv_30: number
            z_30: number
            desviacion_pct: number
            es_anomalia: boolean
          }[]
      }
      ia_cuadre_openai: {
        Args: {
            p_desde: string
            p_hasta: string
          }
        Returns: Json
      }
      ia_funciones_sin_registro: {
        Args: {
            p_dias?: number
          }
        Returns: {
            funcion: string
            descripcion: string
            instrumentada: boolean
            ultima_fila: string
            dias_sin_registro: number
          }[]
      }
      ia_grupo_de_funcion: {
        Args: {
            p_funcion: string
          }
        Returns: string
      }
      ia_modelos_centro: {
        Args: {
            p_dias?: number
          }
        Returns: Json
      }
      ia_modelos_disparar: {
        Args: never
        Returns: boolean
      }
      ia_modelos_registrar: {
        Args: {
            p_modelos: Json
          }
        Returns: Json
      }
      ia_proceso_de_funcion: {
        Args: {
            p_funcion: string
          }
        Returns: string
      }
      ia_proceso_gasto: {
        Args: {
            p_funcion: string
          }
        Returns: string
      }
      ia_registrar_uso: {
        Args: {
            p_funcion: string
            p_modelo: string
            p_prompt_tokens?: number
            p_completion_tokens?: number
            p_razonamiento_tokens?: number
            p_cached_tokens?: number
            p_cache_write_tokens?: number
            p_llamadas?: number
            p_operacion?: string
            p_estado?: string
            p_disparador?: string
            p_duracion_ms?: number
          }
        Returns: {
            id: number
            coste_usd: number
            tarifado: boolean
          }[]
      }
      ia_retarifar_sin_coste: {
        Args: {
            p_modelo?: string
          }
        Returns: number
      }
      informe_auditoria_mensual: {
        Args: {
            p_mes: string
          }
        Returns: Json
      }
      iniciar_cambio_contrasena: {
        Args: {
            p_actor: string
          }
        Returns: Json
      }
      iniciar_intento_panel: {
        Args: {
            p_email: string
            p_ruta?: string
          }
        Returns: Json
      }
      instalar_auditoria_panel: {
        Args: never
        Returns: undefined
      }
      is_admin: {
        Args: {
            _user_id: string
          }
        Returns: boolean
      }
      is_super_admin: {
        Args: {
            _user_id: string
          }
        Returns: boolean
      }
      listar_tablas_auditoria_panel: {
        Args: never
        Returns: {
            tabla: string
          }[]
      }
      marcar_avisos_revisados: {
        Args: {
            p_ids?: string[]
            p_tipos?: string[]
          }
        Returns: number
      }
      oficiososia_facturacion_eliminar: {
        Args: {
            p_id: string
            p_estado: string
            p_version: string
          }
        Returns: Json
      }
      oficiososia_facturacion_guardar: {
        Args: {
            p_documento: Json
            p_version_config: string
            p_id?: string
            p_version_factura?: string
          }
        Returns: Json
      }
      oficiososia_facturacion_guardar_v2: {
        Args: {
            p_documento: Json
            p_version_config: string
            p_id?: string
            p_version_factura?: string
            p_borrador_id?: string
            p_version_borrador?: string
            p_emitir?: boolean
            p_factura_origen?: string
          }
        Returns: Json
      }
      oficiososia_facturacion_leer: {
        Args: never
        Returns: Json
      }
      openai_despachar_sincronizacion_costes: {
        Args: never
        Returns: number
      }
      openai_sincronizar_ahora: {
        Args: never
        Returns: number
      }
      peticion_reservar_analisis: {
        Args: {
            p_id: string
            p_forzar?: boolean
          }
        Returns: unknown[]
      }
      peticiones_ruta_captura_valida: {
        Args: {
            p_nombre: string
          }
        Returns: boolean
      }
      preparar_contexto_auditoria_auth: {
        Args: {
            p_actor_id: string
            p_operacion: string
            p_user_id?: string
            p_email?: string
          }
        Returns: string
      }
      registrar_acceso_panel: {
        Args: {
            p_tipo: string
            p_ruta?: string
          }
        Returns: string
      }
      registrar_accion_auditoria_panel: {
        Args: {
            p_operacion: string
            p_detalles?: Json
          }
        Returns: string
      }
      revertir_cambio_auditoria: {
        Args: {
            p_evento: string
            p_actor: string
            p_confirmar?: boolean
          }
        Returns: Json
      }
      seccion_aviso: {
        Args: {
            p_tipo: string
          }
        Returns: string
      }
      servicios_limites_validos: {
        Args: {
            p: Json
          }
        Returns: boolean
      }
      servicios_metricas_bd_extra: {
        Args: never
        Returns: Json
      }
      servicios_metricas_supabase: {
        Args: never
        Returns: Json
      }
      servicios_resumen_mes: {
        Args: {
            p_mes: string
          }
        Returns: {
            proveedor: string
            manual_importe: number
            manual_moneda: string
            manual_nota: string
            coste_variable: Json
            ultima_lectura: string
            lecturas: number
          }[]
      }
      servicios_uso_ultimas: {
        Args: never
        Returns: unknown[]
      }
      tipo_cambio_usd_eur_actual: {
        Args: never
        Returns: {
            eur_por_usd: number
            fecha: string
            fuente: string
          }[]
      }
      url_funcion_edge: {
        Args: {
            p_funcion: string
          }
        Returns: string
      }
      version_auditoria_panel: {
        Args: never
        Returns: number
      }
      vigilante_fallos_telegram: {
        Args: never
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "staff"],
    },
  },
} as const
