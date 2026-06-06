package store

// DefaultStylePresets 返回内置风格预设的种子 JSON（供「恢复默认」接口使用）。
func (s *MySQLStore) DefaultStylePresets() string { return DefaultStylePresetsJSON }

// DefaultStylePresetsJSON 是内置风格预设的种子数据（唯一真相源）。
// 用途：1) settings.style_presets 列首次创建时 seed 入库；2) 后台「恢复默认」接口返回。
// 前端不再各持一份硬编码副本，统一以库中数据为准，避免前后端割裂。
const DefaultStylePresetsJSON = `[
{"id":"realistic","label":"照片级写实","icon":"Camera","desc":"真实光影·极致细节","hint":"ultra realistic, photorealistic, 8K, detailed, sharp focus, natural lighting, lifelike textures","enabled":true,"order":0},
{"id":"cyberpunk","label":"赛博朋克","icon":"Zap","desc":"霓虹都市·未来科技","hint":"cyberpunk cityscape, neon signs reflecting on wet pavement, rain drenched streets, futuristic skyscrapers, vibrant purple and cyan lighting, dystopian atmosphere, high contrast, blade runner aesthetic","enabled":true,"order":1},
{"id":"anime","label":"日系动漫","icon":"Cat","desc":"赛璐珞风格·明亮色彩","hint":"anime style, cel shading, vibrant colors, manga aesthetic, clean lineart, expressive eyes, studio ghibli inspired backgrounds, soft lighting","enabled":true,"order":2},
{"id":"watercolor","label":"水彩手绘","icon":"Droplets","desc":"柔和晕染·通透质感","hint":"watercolor painting on textured paper, soft color washes, flowing pigments, wet on wet technique, artistic, dreamy atmosphere, visible brush strokes","enabled":true,"order":3},
{"id":"3d","label":"3D 渲染","icon":"Box","desc":"立体逼真·光影追踪","hint":"3D render, octane render, cinematic lighting, ray tracing, detailed textures, subsurface scattering, volumetric fog, hyperrealistic CG","enabled":true,"order":4},
{"id":"ghibli","label":"宫崎骏风","icon":"Ghost","desc":"治愈温暖·手绘质感","hint":"Studio Ghibli inspired, hand painted backgrounds, soft pastel colors, whimsical atmosphere, lush greenery, warm sunlight filtering through trees, nostalgic and heartwarming","enabled":true,"order":5},
{"id":"fantasy","label":"奇幻史诗","icon":"Flame","desc":"魔法世界·史诗氛围","hint":"epic fantasy scene, magical glowing elements, ethereal atmosphere, ancient ruins, floating islands, mystical creatures, dramatic lighting, otherworldly landscapes","enabled":true,"order":6},
{"id":"sketch","label":"素描线稿","icon":"Scan","desc":"黑白线条·精细笔触","hint":"pencil sketch, detailed cross-hatching, charcoal drawing, black and white, fine art, paper texture, academic drawing style, high detail linework","enabled":true,"order":7},
{"id":"oil","label":"油画古典","icon":"Palette","desc":"厚重笔触·大师质感","hint":"oil painting on canvas, impasto technique, thick visible brushstrokes, classical art style, rich warm color palette, renaissance inspired, museum quality","enabled":true,"order":8},
{"id":"pixel","label":"像素复古","icon":"Dice1","desc":"8bit 怀旧·游戏风","hint":"pixel art, retro 8-bit video game style, limited color palette, chunky pixels, blocky sprites, retro gaming aesthetic, NES inspired","enabled":true,"order":9},
{"id":"frost","label":"冰雪奇境","icon":"Snowflake","desc":"晶莹剔透·冬日幻境","hint":"winter wonderland, crystalline ice formations, frost on glass, snow covered landscape, ethereal blue and white palette, sparkling ice crystals, aurora borealis in sky","enabled":true,"order":10},
{"id":"sunset","label":"日落金辉","icon":"Sunset","desc":"金色余晖·温暖氛围","hint":"golden hour photography, warm sunset tones, dramatic orange and pink sky, sun rays piercing through clouds, silhouettes, atmospheric perspective, rich warm glow","enabled":true,"order":11},
{"id":"landscape","label":"山水意境","icon":"Mountain","desc":"水墨山河·自然壮阔","hint":"traditional Chinese ink wash painting, misty mountains layered in fog, pine trees on cliffs, waterfall cascading down rocks, zen atmosphere, negative space, horizontal scroll composition","enabled":true,"order":12},
{"id":"sci-fi","label":"科幻星际","icon":"Telescope","desc":"太空探索·未来科技","hint":"sci-fi spaceship interior or exterior, futuristic technology, holographic displays, sleek minimal design, deep space nebula background, advanced civilization, blade runner meets star trek","enabled":true,"order":13},
{"id":"noir","label":"黑色电影","icon":"Moon","desc":"黑白光影·悬疑氛围","hint":"film noir style, high contrast black and white, dramatic shadows, venetian blind lighting, detective aesthetic, moody atmosphere, rain soaked streets, 1940s style","enabled":true,"order":14},
{"id":"ghostly","label":"灵异诡谲","icon":"Ghost","desc":"幽暗神秘·超自然","hint":"haunted atmosphere, eerie fog, ghostly apparitions, abandoned Gothic mansion, moonlight through broken windows, supernatural, dark and mysterious mood","enabled":true,"order":15},
{"id":"pop-art","label":"波普艺术","icon":"Sparkles","desc":"鲜艳撞色·漫画风格","hint":"pop art style, Andy Warhol inspired, bold vibrant colors, comic book halftone dots, high contrast, repetitive patterns, screen print effect, retro 1960s aesthetic","enabled":true,"order":16},
{"id":"steampunk","label":"蒸汽朋克","icon":"Gem","desc":"维多利亚·机械美学","hint":"steampunk aesthetic, Victorian era machinery, brass and copper gears, steam powered airships, vintage industrial, intricate mechanical details, sepia tone atmosphere","enabled":true,"order":17},
{"id":"minimalist","label":"极简主义","icon":"CircleDot","desc":"少即是多·干净留白","hint":"minimalist design, clean composition, ample negative space, simple geometric shapes, muted color palette, modern aesthetic, zen like simplicity","enabled":true,"order":18},
{"id":"vintage","label":"复古胶片","icon":"Camera","desc":"胶片质感·怀旧色调","hint":"vintage film photography, Kodachrome tones, grainy texture, light leaks, analog warmth, 1970s aesthetic, retro color grading, imperfect and authentic","enabled":true,"order":19},
{"id":"glitch","label":"故障艺术","icon":"Waves","desc":"数字失真·赛博美学","hint":"glitch art, digital distortion, RGB split effect, scan lines, corrupted data aesthetic, vivid neon colors on dark background, cyberpunk digital art","enabled":true,"order":20},
{"id":"ukiyo-e","label":"浮世绘","icon":"CloudSun","desc":"江户风韵·木板套色","hint":"ukiyo-e woodblock print style, Hokusai inspired, bold outlines, flat color areas, wave patterns, traditional Japanese art, cherry blossoms, Mount Fuji, indigo and vermillion palette","enabled":true,"order":21},
{"id":"baroque","label":"巴洛克","icon":"Diamond","desc":"华丽戏剧·暗调光影","hint":"baroque painting style, dramatic chiaroscuro lighting, rich deep colors, ornate details, Caravaggio inspired, tenebrism, religious or mythological scene, 17th century masterpiece","enabled":true,"order":22},
{"id":"chibi","label":"Q版可爱","icon":"Star","desc":"圆润萌系·治愈风格","hint":"chibi art style, cute and adorable, oversized head and eyes, small body, kawaii aesthetic, soft pastel colors, round shapes, manga chibi proportions","enabled":true,"order":23},
{"id":"origami","label":"折纸艺术","icon":"Diamond","desc":"几何折叠·纸艺质感","hint":"origami style, geometric paper folds, crisp creases, textured paper surface, minimalist color scheme, three dimensional paper sculpture, soft studio lighting","enabled":true,"order":24}
]`
