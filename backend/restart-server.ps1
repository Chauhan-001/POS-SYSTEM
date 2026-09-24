$procs = Get-CimInstance Win32_Process -Filter "Name like 'node%'" | Where-Object { $_.CommandLine -like '*server.ts*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Output ("killed " + $p.ProcessId) }
Start-Sleep -Seconds 2
Start-Process -FilePath 'npx.cmd' -ArgumentList 'tsx','src/server.ts' -WorkingDirectory 'C:\Loyalty_POS system\backend' -WindowStyle Hidden -RedirectStandardOutput 'C:\Loyalty_POS system\backend\server-demo.log' -RedirectStandardError 'C:\Loyalty_POS system\backend\server-demo.err.log'
Write-Output "server restarting..."
