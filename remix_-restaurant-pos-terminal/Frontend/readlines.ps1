$lines = Get-Content "C:\Loyalty_POS system\remix_-restaurant-pos-terminal\Frontend\src\App.tsx"
for ($i = 1543; $i -lt 1551; $i++) { Write-Output ('{0,4}: [{1}]' -f $i, $lines[$i]) }
