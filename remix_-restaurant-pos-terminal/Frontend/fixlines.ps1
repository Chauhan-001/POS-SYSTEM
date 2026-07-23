$lines = Get-Content "C:\Loyalty_POS system\remix_-restaurant-pos-terminal\Frontend\src\App.tsx"
# Fix line 1549: replace "                  ))}" with just "                         )}"
$lines[1548] = "                         )}"
Set-Content -Path "C:\Loyalty_POS system\remix_-restaurant-pos-terminal\Frontend\src\App.tsx" -Value $lines -Encoding UTF8
Write-Output "Fixed line 1549"
