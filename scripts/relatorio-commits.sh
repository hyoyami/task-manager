#!/usr/bin/env bash
# Relatório dos commits de um período, em Markdown (saída padrão).
#
# Uso:  scripts/relatorio-commits.sh dia|semana|mes [AAAA-MM-DD]
#       scripts/relatorio-commits.sh AAAA-MM-DD AAAA-MM-DD      (intervalo personalizado, datas inclusivas)
#
#   dia     o dia de hoje (ou o dia informado)
#   semana  de segunda-feira a domingo da semana de hoje (ou da data informada)
#   mes     do dia 1 ao fim do mês de hoje (ou da data informada)
#
# Usado pelo agente "relatorio-commits" (.claude/agents/relatorio-commits.md), que acrescenta o resumo.
set -euo pipefail
export LC_ALL=C.UTF-8

cd "$(git rev-parse --show-toplevel)"

periodo="${1:-}"
ref="${2:-$(date +%F)}"

case "$periodo" in
  dia)
    inicio="$ref"; fim="$ref"; titulo="Dia $(date -d "$ref" +%d/%m/%Y)" ;;
  semana)
    dow=$(date -d "$ref" +%u)                       # 1 = segunda
    inicio=$(date -d "$ref -$((dow - 1)) days" +%F)
    fim=$(date -d "$inicio +6 days" +%F)
    titulo="Semana de $(date -d "$inicio" +%d/%m) a $(date -d "$fim" +%d/%m/%Y)" ;;
  mes)
    inicio=$(date -d "$ref" +%Y-%m-01)
    fim=$(date -d "$inicio +1 month -1 day" +%F)
    titulo="Mês $(date -d "$inicio" +%m/%Y)" ;;
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
    inicio="$periodo"; fim="${2:?informe a data final (AAAA-MM-DD)}"
    titulo="De $(date -d "$inicio" +%d/%m/%Y) a $(date -d "$fim" +%d/%m/%Y)" ;;
  *)
    echo "Uso: $0 dia|semana|mes [AAAA-MM-DD]  ou  $0 AAAA-MM-DD AAAA-MM-DD" >&2
    exit 2 ;;
esac

since="$inicio 00:00:00"
until="$fim 23:59:59"
range=(--since="$since" --until="$until")

total=$(git log "${range[@]}" --pretty=%H | wc -l)
repo=$(basename "$(git rev-parse --show-toplevel)")
branch=$(git rev-parse --abbrev-ref HEAD)

echo "# Relatório de commits — $titulo"
echo
echo "_Repositório \`$repo\` · branch \`$branch\` · período $(date -d "$inicio" +%d/%m/%Y) a $(date -d "$fim" +%d/%m/%Y) · gerado em $(date '+%d/%m/%Y %H:%M')_"
echo

if [ "$total" -eq 0 ]; then
  echo "Nenhum commit neste período."
  exit 0
fi

# Totais de linhas e arquivos (sem merges, para não contar duas vezes).
read -r adds dels files < <(git log "${range[@]}" --no-merges --numstat --pretty=tformat: \
  | awk '$1 ~ /^[0-9]+$/ { a += $1; d += $2 } NF == 3 { f[$3] = 1 } END { n = 0; for (k in f) n++; print a + 0, d + 0, n }')
dias=$(git log "${range[@]}" --date=format:%F --pretty=%ad | sort -u | wc -l)

echo "## Números"
echo
echo "| Commits | Dias com commits | Arquivos alterados | Linhas adicionadas | Linhas removidas |"
echo "|---:|---:|---:|---:|---:|"
echo "| $total | $dias | $files | +$adds | −$dels |"
echo

echo "## Por autor"
echo
echo "| Autor | Commits |"
echo "|---|---:|"
git log "${range[@]}" --pretty=%an | sort | uniq -c | sort -rn | awk '{ n = $1; $1 = ""; sub(/^ /, ""); printf "| %s | %d |\n", $0, n }'
echo

echo "## Áreas do código mais alteradas"
echo
echo "| Área | Arquivos | Linhas (+/−) |"
echo "|---|---:|---:|"
git log "${range[@]}" --no-merges --numstat --pretty=tformat: | awk '
  NF == 3 && $1 ~ /^[0-9]+$/ {
    path = $3; n = split(path, p, "/");
    area = (n >= 3) ? p[1] "/" p[2] : (n == 2 ? p[1] : "(raiz)");
    if (!((area, path) in seen)) { seen[area, path] = 1; files[area]++ }
    add[area] += $1; del[area] += $2
  }
  END { for (a in add) printf "%d\t| %s | %d | +%d / −%d |\n", add[a] + del[a], a, files[a], add[a], del[a] }' \
  | sort -rn | cut -f2- | head -12
echo

DIAS=([1]="Segunda-feira" [2]="Terça-feira" [3]="Quarta-feira" [4]="Quinta-feira" [5]="Sexta-feira" [6]="Sábado" [7]="Domingo")
echo "## Commits por dia"
for d in $(git log "${range[@]}" --date=format:%F --pretty=%ad | sort -u); do
  echo
  echo "### ${DIAS[$(date -d "$d" +%u)]}, $(date -d "$d" +%d/%m/%Y)"
  echo
  git log --since="$d 00:00:00" --until="$d 23:59:59" --reverse --date=format:%H:%M \
    --pretty='format:%h%x09%ad%x09%an%x09%s%x09%b%x1e' | awk -v RS='\x1e' -F'\t' '
    NF >= 4 {
      sub(/^\n/, "", $1);
      printf "- **%s** · `%s` · %s — %s\n", $2, $1, $3, $4;
      # Corpo da mensagem: cada linha vira um tópico; linhas recuadas continuam o tópico anterior.
      n = split($5, lines, "\n"); k = 0;
      for (i = 1; i <= n; i++) {
        l = lines[i];
        if (l ~ /^Co-Authored-By:/ || l ~ /^[[:space:]]*$/) continue;
        if (l ~ /^[[:space:]][[:space:]]/ && k > 0) { sub(/^[[:space:]]+/, "", l); item[k] = item[k] " " l; continue; }
        sub(/^[[:space:]]*-[[:space:]]*/, "", l);
        item[++k] = l;
      }
      for (i = 1; i <= k; i++) printf "  - %s\n", item[i];
    }'
done
