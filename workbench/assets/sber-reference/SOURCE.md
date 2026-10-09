# Источник перенесённых токенов Plasma / SDDS SERV

Проверено 2026-10-09. Репозиторий [salute-developers/plasma](https://github.com/salute-developers/plasma), commit [`fe399bad3bfa7ffe4eea233c258d944c866e9815`](https://github.com/salute-developers/plasma/commit/fe399bad3bfa7ffe4eea233c258d944c866e9815). Это закреплённый snapshot ветки dev, не рекомендация устанавливать prerelease в рабочий проект.

В [plasma-token-subset.json](plasma-token-subset.json) перенесены **24 исходные пары имя/значение**: по 12 из light и dark CSS темы `sdds_serv`. Значения и имена не изменены; отбор и сериализация в JSON выполнены для этого пакета. Это не вся тема, не скопированный компонент и не официальный брендбук Сбера.

| Источник | Версия/проверка |
|---|---|
| [package.json темы](https://github.com/salute-developers/plasma/blob/fe399bad3bfa7ffe4eea233c258d944c866e9815/packages/themes/sdds-themes/package.json) | `@salutejs/sdds-themes` `0.84.0-dev.0`; `license: MIT` |
| [LICENSE.txt пакета](https://github.com/salute-developers/plasma/blob/fe399bad3bfa7ffe4eea233c258d944c866e9815/packages/themes/sdds-themes/LICENSE.txt) | Полная неизменённая копия рядом: [LICENSE.txt](LICENSE.txt), copyright Salute Devices |
| [light CSS](https://github.com/salute-developers/plasma/blob/fe399bad3bfa7ffe4eea233c258d944c866e9815/packages/themes/sdds-themes/src/css/sdds_serv__light.css) | SHA-256 `44774f88a5657cb54d3217a7fd298ae7d74b4a8164189969869a7011b97b3e3d` |
| [dark CSS](https://github.com/salute-developers/plasma/blob/fe399bad3bfa7ffe4eea233c258d944c866e9815/packages/themes/sdds-themes/src/css/sdds_serv__dark.css) | SHA-256 `e191f29e59ea1e684a50466e336a295f89006306ca433110c86b94ecc2d0f1bb` |
| Сохранённый LICENSE | SHA-256 `b92eec4617fed6e1c22885871cfde4745b37b4432156c5cb649c05455c9bad2f` |

Точные строки каждого токена находятся в `source_files.*.token_lines` JSON. Для выбранного package subtree проверено наличие package LICENSE; отдельная лицензия внутри `src/css` не найдена в полном, не усечённом дереве `packages/themes` этого commit. Это проверка выбранных файлов, не заключение о лицензиях всех assets монорепозитория.

[Optional preset](../../config/design-presets/sber-plasma.json) содержит 8 явных точных mappings в семантические роли (по 4 на тему), а остальные resolved цвета/геометрию — самостоятельные проектные решения. Исходные accent-токены сохранены для происхождения; более тёмные/светлые адаптированные CTA не выдаются за официальные значения. Для распространения перенесённой части сохранять полный LICENSE и эту запись происхождения вместе с preset/приложением, например в third-party notices. Проверку повторять при изменении source commit, пакета, выбранных файлов или содержимого; не на каждом render/task.

Не включены шрифты SB Sans, логотипы/товарные знаки, screenshot, иллюстрации и сторонние иконки. Наличие ссылки на CDN в документации не подтверждает право перераспространять font binary. Компоненты `@salutejs/sdds-serv`/`@salutejs/plasma-web` здесь только рекомендованы по первичным источникам; их JS/CSS и зависимости не вложены. При их реальном подключении сохранить notices точной установленной версии и проверить вложенные assets/зависимости. См. [ASSET_RIGHTS](../../docs/ASSET_RIGHTS.md).
