# Сторонние компоненты и происхождение графики

Инвентаризация выполнена **10 октября 2026 года** по установленным `app/node_modules/*/package.json`, их файлам `LICENSE`/`NOTICE`, `app/package.json` и `app/package-lock.json`. В таблицах указаны фактически разрешённые версии, а не диапазоны из package.json. Это перечень основных компонентов и источников уведомлений; он не назначает лицензию исходному коду GigaCode Workbench и не заменяет полные лицензии всех компонентов конкретной бинарной сборки.

`node_modules/` не включается в Git-репозиторий. `npm ci` получает зависимости по lockfile. При обновлении lockfile нужно обновить относящиеся к изменениям записи и проверить notices конечной сборки.

## Основные runtime-компоненты

Пути лицензий в последнем столбце указаны относительно `app/node_modules/` после установки.

| Компонент / первичный репозиторий | Установленная версия | Лицензия и источник |
| --- | --- | --- |
| [Qwen Code](https://github.com/QwenLM/qwen-code) — `@qwen-code/qwen-code` | 0.25.1 | Apache-2.0, `@qwen-code/qwen-code/LICENSE`. Поле `license` в package.json этого опубликованного пакета отсутствует; классификация основана на полном поставленном LICENSE |
| [node-pty fork](https://github.com/lydell/node-pty) — `@lydell/node-pty` | 1.2.0-beta.15 | MIT, `@lydell/node-pty/LICENSE` |
| [xterm.js](https://github.com/xtermjs/xterm.js) — `@xterm/xterm` | 6.0.0 | MIT, `@xterm/xterm/LICENSE` |
| [xterm fit addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) — `@xterm/addon-fit` | 0.11.0 | MIT, `@xterm/addon-fit/LICENSE` |
| [React](https://github.com/facebook/react) — `react`, `react-dom` | 19.3.0 / 19.3.0 | MIT, `react/LICENSE`, `react-dom/LICENSE` |
| [react-markdown](https://github.com/remarkjs/react-markdown) | 10.1.0 | MIT, `react-markdown/license` |
| [remark-gfm](https://github.com/remarkjs/remark-gfm) | 4.0.1 | MIT, `remark-gfm/license` |
| [Sharp](https://github.com/lovell/sharp) — override платформенной зависимости | 0.35.5 | Apache-2.0, `sharp/LICENSE`. Лицензии libvips и других включённых библиотек проверяются отдельно по платформенным пакетам |
| [Electron](https://github.com/electron/electron) — оболочка готового приложения | 44.7.0 | MIT, `electron/LICENSE`; отдельные notices Chromium/Node и вложенных компонентов находятся в поставке Electron, в том числе `electron/dist/LICENSES.chromium.html` |

Electron записан как devDependency, но его runtime входит в desktop-приложение. Нельзя исключить его из notices готовой сборки только по этому классификатору npm. Аналогично Qwen и `@lydell/node-pty` имеют платформенные optional dependencies; полный набор Windows x64 отличается от установленного на macOS arm64. В lockfile присутствуют соответствующие Windows-пакеты, однако их бинарные notices нужно проверять в фактически собранном Windows-артефакте.

Основные сохранённые attribution-строки из файлов лицензий:

- Qwen: `Copyright 2025 Google LLC`; `Copyright 2025 Qwen`.
- node-pty fork: `Copyright (c) 2026 Simon Lydell`.
- xterm.js: `Copyright (c) 2017-2019, The xterm.js authors`; `Copyright (c) 2014-2016, SourceLair Private Company`; `Copyright (c) 2012-2013, Christopher Jeffrey`. Addon fit: `Copyright (c) 2019, The xterm.js authors`.
- React/React DOM: `Copyright (c) Meta Platforms, Inc. and affiliates.`
- react-markdown: `Copyright (c) Espen Hovlandsdal`.
- remark-gfm: `Copyright (c) Titus Wormer`. Полный файл сохраняет контактную строку автора; сокращённый перечень здесь его не заменяет.
- Electron: `Copyright (c) Electron contributors`; `Copyright (c) 2013-2020 GitHub Inc.`

Это вспомогательный индекс attribution, не новая редакция upstream-лицензий. Полные тексты, включая условия, disclaimer и дополнительные copyright notices, сохраняются без сокращений при включении соответствующего компонента.

## Инструменты разработки и тестирования

| Компонент / первичный репозиторий | Установленная версия | Лицензия / локальный файл |
| --- | --- | --- |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) — `@types/node` | 24.19.1 | MIT, `@types/node/LICENSE` |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) — `@types/react`, `@types/react-dom` | 19.3.0 / 19.3.0 | MIT, соответствующий `LICENSE` |
| [Vite React plugin](https://github.com/vitejs/vite-plugin-react) — `@vitejs/plugin-react` | 6.1.2 | MIT, `@vitejs/plugin-react/LICENSE` |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | MIT, `electron-builder/LICENSE` |
| [Electron downloader](https://github.com/electron/get) — override `@electron/get` | 5.1.0 | MIT, `@electron/get/LICENSE` |
| [esbuild](https://github.com/evanw/esbuild) | 0.28.2 | MIT, `esbuild/LICENSE.md` |
| [Playwright](https://github.com/microsoft/playwright) | 1.64.0 | Apache-2.0, `playwright/LICENSE`, `playwright/NOTICE` |
| [TypeScript](https://github.com/microsoft/TypeScript) | 6.0.3 | Apache-2.0, `typescript/LICENSE.txt` |
| [Vite](https://github.com/vitejs/vite) | 8.3.4 | MIT для Vite, `vite/LICENSE.md` также содержит лицензии и уведомления встроенных компонентов |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0.3 | MIT для Vitest, `vitest/LICENSE.md` также содержит лицензии и уведомления встроенных компонентов |

Playwright NOTICE указывает Microsoft Corporation и производный код Puppeteer под Apache-2.0. Полные Vite/Vitest LICENSE содержат много дополнительных notices; их нельзя заменить одной строкой «MIT». Инструменты сборки не обязательно поставляются пользователю, но результаты bundling могут содержать код зависимостей и их legal comments.

## Собственная графика и лицензированный набор токенов

- `workbench/assets/icons/`, `workbench/assets/icons.json` и копии UI-иконок в `app/public/icons/` — собственные простые векторные формы, подготовленные для этого проекта; происхождение описано в [ICON_LIBRARY.md](../workbench/docs/ICON_LIBRARY.md). Это не экспорт Lucide, Material Icons или другой сторонней библиотеки.
- `app/build/icon.svg` — собственный геометрический значок приложения; `icon.png` и `icon.ico` являются его raster/package-вариантами. Он не использует логотипы Qwen, GigaCode, Сбера или изображения из чужого Desktop-приложения. Собственное происхождение не является обещанием абсолютной уникальности общеупотребительных форм и не назначает проекту лицензию.
- Файлы шрифтов Segoe UI/Consolas и других системных семейств не поставляются: CSS использует доступные системе шрифты. Лицензия npm-компонента не распространяется автоматически на шрифт или бренд из его документации.
- В `workbench/assets/sber-reference/` включён ограниченный subset Plasma / SDDS SERV: 24 точные пары CSS-токенов из `@salutejs/sdds-themes` 0.84.0-dev.0, commit `fe399bad3bfa7ffe4eea233c258d944c866e9815`. Сохранены полный [MIT LICENSE](../workbench/assets/sber-reference/LICENSE.txt), `Copyright (c) Salute Devices` и [SOURCE.md](../workbench/assets/sber-reference/SOURCE.md) с происхождением/хешами/преобразованием. Это не весь SDK, брендбук, font binary или логотип. Этот notice сохранять вместе с subset и производным preset.
- Материалы `mock-*` и исторические снимки в Workbench показывают собственный эскиз; они не доказывают реализацию desktop-функций. Ссылки на официальные страницы других продуктов не являются разрешением копировать их screenshots/assets.

Правила добавления новых изображений, SVG, шрифтов и референсов: [ASSET_RIGHTS.md](../workbench/docs/ASSET_RIGHTS.md).

## При сборке и распространении

Сохранять полные upstream LICENSE/NOTICE, нужные вложенным runtime-компонентам, legal comments сборщика, notices Electron/Chromium/Node, Qwen и платформенных библиотек. Проверять состав конкретного installer/portable, а не только исходную npm-таблицу. Справочный перечень выше не утверждает, что все transitive notices Windows-сборки уже проверены.

Исходный репозиторий не включает GigaCode-форк или его установщик. Возможность выбрать отдельно установленный GigaCode в настройках не означает права на его перераспространение и не распространяет на него лицензию Qwen. Корневой [LICENSE](../LICENSE) лицензирует собственный код, документацию и созданные для проекта материалы по Apache-2.0, кроме участков с отдельной вложенной лицензией. Этот документ не меняет лицензии сторонних компонентов, reference-токенов и отдельно лицензированных assets.

## Embedded IDE runtime (14 October 2026)

The optional self-contained IDE uses Eclipse Theia 1.76.0 (EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0, with component-specific notices), Monaco/VS Code open-source components and individually licensed Open VSX extensions. Exact publisher/version/manifestVersion, source URLs, archive SHA-256, API declarations, native target and license files are retained in `ide/plugins-lock.json`. The Microsoft Marketplace product and proprietary IntelliJ Ultimate modules are not distributed. The project-owned bridge/theme are Apache-2.0.

The independent official Node.js 22.23.3 runtime retains its LICENSE. The Temurin Java 21 distribution retains its GPLv2 + Classpath exception and third-party notices; exact corresponding source download and checksum are in `ide/toolchains-lock.json`. Maven retains its Apache-2.0 LICENSE and NOTICE. Packaging preserves distribution files and npm package licenses; application license does not replace those terms. Download caches and personal IDE state are excluded.

IDE extraction uses the maintained MIT-licensed `@xhmikosr/decompress` 11.1.4 through the project-owned MIT compatibility adapter in `ide/extensions/decompress-compat`; the adapter does not incorporate the old unmaintained extractor. Exact versions/integrities are retained in the npm lock. `ide/tools/harden-dependencies.mjs` applies a small recursion-depth backport to MIT-licensed braces 3.0.3, preserving its version, source ownership and license. It validates the original source hashes and records the modification marker. Retain the package LICENSE and this modification notice in distributions. Dependency warnings and verification limits are documented in `docs/suite/IDE-RUNTIME-AUDIT.md`; this notice is not a security certification.

## Data workspace runtime (14 October 2026)

The PostgreSQL workspace adds CodeMirror 6 and Lezer (MIT), node-postgres/pg-cursor/pg-query-stream/pg-copy-streams (MIT), MCP TypeScript SDK (MIT), Undici (MIT), Ajv (MIT), sql-formatter (MIT), iconv-lite (MIT), yauzl/yazl (MIT), saxes and xmlchars (ISC, with retained original sax notice). Exact installed versions and full upstream license copies are retained in `app/third-party/database/inventory.json` and adjacent text files, included in application packaging. The pg-copy-streams license is preserved from its published README license section; saxes 6.0.0 retains the complete license from its matching upstream tag because its npm package omits that file. Own Data SVGs and UI are project code. CodeMirror color tokens are independently specified; no proprietary DataGrip code, assets, icons or fonts are distributed. PostgreSQL server binaries installed for isolated local tests are not redistributed by this package. The builtin driver speaks PostgreSQL protocol; it is not a generic JDBC implementation.
