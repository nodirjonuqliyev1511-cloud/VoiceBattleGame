# Ползунки наперегонки: иллюстрации малышей

`babies.png` — локальный PNG-атлас с прозрачностью, 4 столбца × 2 строки.
Первая строка — мальчик, вторая — девочка. Столбцы: две фазы ползания,
празднование с погремушкой, дополнительная поза ползания. Кадры выбираются CSS.

Создан встроенным инструментом imagegen для этого проекта. Работает без внешних API.

Промпт: прозрачный атлас детской 2D-игры в пастельном рисованном стиле;
малыш с голубым подгузником и малышка с розовым бантом и подгузником;
две фазы ползания вправо и сидячая поза победы с погремушкой;
тёплый коричневый контур, персиковая кожа, румяные щёки, простые формы,
одинаковый масштаб всех персонажей, без текста и фона.

Игрушки нарисованы в `public/nursery-art.js`, обои и декорации — в CSS.

`babies-finale.png` — отредактированный через imagegen атлас с плачущими
персонажами в четвёртом столбце. Используется для проигравшего малыша.
Ползание и радость победителя используют первоначальный `babies.png`.

Промпт правки: Edit the provided transparent baby sprite atlas. Keep the exact
4-column by 2-row layout and transparency. Preserve columns 1, 2 and 3 in both rows.
Modify only column 4: cute crying seated babies, closed squinting eyes, visible blue
teardrops, trembling downturned open mouth, hands wiping tears. Preserve peach skin,
warm brown outlines, textured nursery style, blue diaper for boy and pink diaper and
bow for girl, same cell bounds, scale and ground baseline. No text, grid or background.

## Полный промпт imagegen

Create a production-ready transparent PNG sprite atlas for a children's voice-controlled crawling race, matching a soft hand-drawn 2D nursery cartoon. Exactly 4 equal columns and 2 equal rows, a wide 2:1 sheet, NO grid lines, NO text, NO labels, NO backdrop. Each cell contains one complete baby character, centered, same scale with generous transparent padding and no overlap between cells. Fine warm brown outlines, flat pastel peach skin, rosy cheeks, round large head, tiny dark eyes, cute friendly expression, simple charming illustration, NOT 3D, NOT photorealistic. First row: baby BOY, one tiny curly hair on head, turquoise blue diaper. Cell 1 boy crawling towards RIGHT, side three-quarter view with both hands near floor. Cell 2 same boy crawling towards RIGHT with slightly different arm and knee pose, same body proportions and bounding box as cell 1. Cell 3 same boy sitting facing camera, celebrating smiling, holding a small blue star rattle aloft. Cell 4 same boy crawling towards RIGHT, open smiling mouth to cheer, same placement as cell1. Second row: same four poses in same order for baby GIRL with pink bow on top of head, rose pink diaper, long eyelashes. All babies fully visible, all hands and feet and head inside own cells. Keep the girl and boy equally cute and exactly matched illustration style. Transparent background is essential. Small soft pale oval ground shadow permitted beneath each baby. Reference aesthetic: pastel teal and blush pink nursery game, paper storybook drawing, warm brown contour line, simple colored shapes.
