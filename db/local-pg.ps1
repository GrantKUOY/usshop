# 本機開發用 PostgreSQL（獨立實例，port 5433，資料在專案內 .pgdata，不動系統既有的 PostgreSQL 服務）
# 用法：powershell -File db/local-pg.ps1 start|stop|status
# 注意：log 必須放在資料夾外（放在 .pgdata 內會造成 Windows 檔案共用衝突、無法啟動）。
param([Parameter(Mandatory)][ValidateSet('start','stop','status')]$Action)
$bin = 'C:\Program Files\PostgreSQL\15\bin'
$data = Join-Path $PSScriptRoot '..\.pgdata'
$log = Join-Path $env:LOCALAPPDATA 'Temp\usshop-pg.log'
switch ($Action) {
  'start'  { Start-Process -FilePath "$bin\pg_ctl.exe" -ArgumentList @('-D', $data, '-o', '"-p 5433"', '-l', $log, 'start') -WindowStyle Hidden }
  'stop'   { & "$bin\pg_ctl.exe" -D $data stop }
  'status' { & "$bin\pg_ctl.exe" -D $data status }
}
