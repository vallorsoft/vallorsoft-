-- ============================================================
--  VallorSoft — Pihenő / szünet utáni rakodóhely: a meglévő fuvarok újraszámolása
--  Inkrementális migráció (idempotens, egyszer fut) — a motor mostantól felismeri a
--  napi pihenőt (≥ 8 óra) és a vezetési szünetet (30–75 perc, út mellett), és ha
--  utána a közelben még megállt (akár csak 2 percre), azt a helyet részesíti előnyben.
--  A még nem lezárt (auto / suggested / unmatched) állomású fuvarokat az utolsó
--  60 napból újra sorba állítjuk; a confirmed / rejected döntést az újrafuttatás
--  továbbra sem írja felül. A háttér-ütemező körönként 15 fuvart dolgoz fel.
-- ============================================================
UPDATE stop_match_state st SET requeued = true, attempts = 0
 WHERE st.requeued = false
   AND st.order_id IN (
     SELECT DISTINCT s.order_id FROM order_stops s
      WHERE s.match_status IN ('auto','suggested','unmatched')
        AND s.matched_at > NOW() - INTERVAL '60 days');
