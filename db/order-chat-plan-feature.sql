-- ============================================================
--  VallorSoft — 💬 Szöveges fuvarkiírás (AI-chat) csomag-kapu
--  A funkció a Pro csomagtól érhető el: az Alap (sort_order=1) és a
--  Standard (sort_order=2) csomagnál explicit KI, a Pro/Business-nél
--  nincs sor (= bekapcsolva). A developer cégenként felülírhatja
--  (company_features). Idempotens.
-- ============================================================
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT sp.id, 'ai-szoveges-fuvar', false
  FROM subscription_plans sp
 WHERE sp.sort_order IN (1, 2)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = false;

DELETE FROM plan_features
 WHERE feature_key = 'ai-szoveges-fuvar'
   AND plan_id IN (SELECT id FROM subscription_plans WHERE sort_order IN (3, 4));
