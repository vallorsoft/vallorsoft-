-- A „Megbízás" (assignment) és a „Megrendelő" (order) dokumentum-típus EGY típus:
-- „Megbízás / megrendelő" (doc_type='order'). A régi assignment sorok átírása.
UPDATE order_documents SET doc_type = 'order' WHERE doc_type = 'assignment';
