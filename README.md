# Game Optimizer

`python optimizer.py` (нужен Python 3 с tkinter) → выбери игру → **Оптимизировать**.

- **Minecraft** - минимальная графика в `options.txt` + ресурспак `PotatoGray.zip`: стены, земля, дерево, листва, песок серые; руды, вода, лава и свет не трогаются.
- **Counter-Strike 2** - `autoexec.cfg` с минимальными эффектами.
- **Другая игра** - поднимает приоритет процесса.

Перед изменениями делается бэкап, кнопка **Откатить** возвращает всё назад.

## Телефон (`phone/index.html`)

Мобильная версия: открой `phone/index.html` на телефоне (или выложи папку `phone/` на любой хостинг/GitHub Pages и добавь на главный экран).
Выбираешь игру, модель телефона и целевой FPS. Максимум FPS считается как минимум из трёх значений: частота экрана, класс железа телефона и лимит самой игры. Кнопка **Оптимизировать** выдаёт список настроек под «картошку»; для Minecraft Bedrock можно скачать `.mcpack` с серыми текстурами.

Версия для ПК - `optimizer.py` (позже будет переделана отдельно).

### APK

Android-проект в `android/` — это оболочка (WebView) вокруг `phone/index.html`. APK собирает GitHub Actions (`.github/workflows/build-apk.yml`) и выкладывает в Releases → `apk-latest` → `GameOptimizer.apk`. Локально: `gradle -p android assembleDebug` (нужен Android SDK).
