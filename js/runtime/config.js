/* ==========================================================================
   Configuração do back-end.

   backend: 'supabase' (padrão, banco real na nuvem) ou 'local' (localStorage
   deste navegador — desenvolvimento e testes automáticos).
   Para forçar o modo local: abrir com ?backend=local na URL,
   ou executar no console: localStorage.setItem('tm_backend', 'local').

   A chave abaixo é a chave PÚBLICA (anon) do Supabase: pode ficar no código,
   pois o acesso aos dados é protegido pelas regras de segurança (RLS) do banco
   — ver supabase/schema.sql. Nunca coloque aqui a chave "service_role".
   ========================================================================== */
window.TM_CONFIG = (function () {
  'use strict';
  var fromUrl = new URLSearchParams(location.search).get('backend');
  var fromStorage = null;
  try { fromStorage = localStorage.getItem('tm_backend'); } catch (e) { /* modo privado */ }
  return {
    backend: fromUrl || fromStorage || 'supabase',
    supabaseUrl: 'https://fguabpdfmqjcmvrpdicg.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZndWFicGRmbXFqY212cnBkaWNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNjcxODQsImV4cCI6MjEwOTk0MzE4NH0.jUggFy-SoOYAsNU6L543zoJ3J0xSwMSFnyn6xKNf3CY',
  };
})();
