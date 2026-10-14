# Windows 37d7308: сохранённый отказ

[GitHub Actions run 38560426468](https://github.com/wuller1/gigacode-workbench/actions/runs/38560426468), candidate `37d7308`.

Настоящий Windows App harness прошёл 7 из 8 сценариев. Последняя проверка light settings после 1440 → 1000 resize отказала: `Composer is outside viewport`. Source/dist hashes не изменились, rendererErrors пуст, cleanup успешен.

Старый report добавлял geometry только после assertions, поэтому фактические значения неудачного кадра отсутствуют. Отказ сам по себе не доказывает ни persistent product overflow, ни stale transition. Новый harness сохраняет failing geometry заранее, ждёт отдельную dock ResizeObserver → React readiness и снимает диагностический PNG при повторном отказе. Исходный overflow oracle не ослаблен. Новый macOS pass не заменяет повторную Windows проверку.

Сохранены только реальный `win32` report и dark screenshot, снятый завершённым третьим сценарием до отказа. Light screenshot при отказе ещё не создавался: найденный одноимённый файл artifact мог быть старым committed macOS evidence и сюда не переносился. Прежние attempt/model/placement reports из того artifact не скопированы.

Отдельная ошибка provenance прежнего artifact: CI stdout сообщил Windows Qwen placement success, но файл placement сохранился старым darwin. Workflow очищен и исправлен для явного нового report path; root сохраняет фактический stdout отдельно. Этот каталог не выдаёт старый darwin файл за Windows проверку.
