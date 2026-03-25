#!/usr/bin/env python3
"""
UniCapture Daily Data Refresh
Fetches active tenant count + DRR from Redash, updates KPI card in HTML.
"""

import os, re, time, json, math, calendar, requests
from datetime import datetime, date

# ── Config ──────────────────────────────────────────────────────────────────
REDASH_BASE   = 'https://redash.unicommerce.com'
API_KEY_VMS   = os.environ.get('REDASH_API_KEY_VMS',  'KVVhenLjwlC8exZiEE7eHrmK5JIlrcmKHGqAaNqD')  # queries 8017/8019
API_KEY_DRR   = os.environ.get('REDASH_API_KEY_DRR',  'iry3fomTLOlUbw6PJntPdqNFSoXsxUGJ0a8Up6Fk')  # query 8432
HTML_PATH     = os.environ.get('HTML_PATH', 'UniCapture_Prospects_Preview.html')

MONTH_NAMES   = {1:'Jan',2:'Feb',3:'Mar',4:'Apr',5:'May',6:'Jun',
                 7:'Jul',8:'Aug',9:'Sep',10:'Oct',11:'Nov',12:'Dec'}

# ── Redash helpers ───────────────────────────────────────────────────────────
def redash_post_and_poll(query_id, api_key, parameters=None, timeout=120):
    """Trigger a Redash query execution and return rows when done."""
    headers = {'Authorization': f'Key {api_key}', 'Content-Type': 'application/json'}
    payload = {'max_age': 0}
    if parameters:
        payload['parameters'] = parameters

    resp = requests.post(f'{REDASH_BASE}/api/queries/{query_id}/results',
                         json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Occasionally returns result directly
    if 'query_result' in data:
        return data['query_result']['data']['rows']

    job_id   = data['job']['id']
    deadline = time.time() + timeout

    while time.time() < deadline:
        time.sleep(3)
        job = requests.get(f'{REDASH_BASE}/api/jobs/{job_id}',
                           headers=headers, timeout=15).json()['job']
        if job['status'] == 3:
            qrid   = job['query_result_id']
            result = requests.get(f'{REDASH_BASE}/api/query_results/{qrid}',
                                  headers=headers, timeout=15).json()
            return result['query_result']['data']['rows']
        if job['status'] == 4:
            raise RuntimeError(f'Query {query_id} failed: {job.get("error")}')

    raise TimeoutError(f'Query {query_id} timed out after {timeout}s')


# ── Data fetching ────────────────────────────────────────────────────────────
def get_active_count():
    rows = redash_post_and_poll(8019, API_KEY_VMS, {'Status': ['ACTIVE']})
    return int(rows[0].get('count(*)', 0))


def get_drr_monthly():
    """Return list of (year, month, drr_per_day) for last 5 months, oldest→newest."""
    rows = redash_post_and_poll(8432, API_KEY_DRR,
                                {'granularity': 'monthly', 'Status': ['ACTIVE']})
    if not rows:
        return []

    keys      = list(rows[0].keys())
    month_key = next((k for k in keys if any(x in k.lower() for x in ('month','period','date'))), keys[0])
    count_key = next((k for k in keys if any(x in k.lower() for x in ('count','record','total'))), keys[-1])

    today   = date.today()
    results = []

    for row in rows:
        parts  = str(row[month_key]).split('-')          # '2026-03' or '2026-03-01'
        year, month = int(parts[0]), int(parts[1])
        count  = int(row.get(count_key) or 0)
        days   = today.day if (year == today.year and month == today.month) \
                           else calendar.monthrange(year, month)[1]
        drr    = round(count / days) if days > 0 else 0
        results.append((year, month, drr))

    results.sort()
    return results[-5:]


# ── HTML update ──────────────────────────────────────────────────────────────
def format_drr(drr):
    if drr >= 1000:
        k = drr / 1000
        return f'~{int(k)}K' if k == int(k) else f'~{k:.1f}K'
    return f'~{drr:,}'


def build_sparkline_bars(monthly_data):
    if not monthly_data:
        return ''
    MAX_H    = 28
    max_drr  = max(d for _, _, d in monthly_data) or 1
    opacities = [0.5, 0.6, 0.75, 0.9, 1.0]
    bars = []
    for i, (_, month, drr) in enumerate(monthly_data):
        h   = max(2, round(drr / max_drr * MAX_H))
        op  = opacities[i] if i < len(opacities) else 1.0
        lbl = f'{MONTH_NAMES[month]}: {drr:,}/day'
        bars.append(
            f'<div title="{lbl}" style="background:#7C3AED;border-radius:2px 2px 0 0;'
            f'width:14px;height:{h}px;opacity:{op}"></div>'
        )
    return '\n        '.join(bars)


def update_html(active_count, monthly_data):
    with open(HTML_PATH, 'r', encoding='utf-8') as f:
        html = f.read()

    # 1. kpi-traction title attribute
    html = re.sub(
        r'title="\d+ active UniCapture tenants([^"]*)"',
        f'title="{active_count} active UniCapture tenants\\1"',
        html
    )

    # 2. kpi-val inside kpi-traction block
    html = re.sub(
        r'(kpi-traction["\'][^>]*>(?:(?!kpi-val).)*?<div class="kpi-val">)\d+(</div>)',
        rf'\g<1>{active_count}\2',
        html, flags=re.DOTALL
    )

    if monthly_data:
        current_drr  = monthly_data[-1][2]
        drr_display  = format_drr(current_drr)

        # 3. DRR sub line
        html = re.sub(r'~[\d.,]+K? recordings/day', f'{drr_display} recordings/day', html)

        # 4. Sparkline title
        parts = [f'{MONTH_NAMES[m]} {d:,}' for _, m, d in monthly_data]
        new_title = 'DRR (recordings/day): ' + ' → '.join(parts)
        html = re.sub(r'title="DRR \(recordings/day\):[^"]*"', f'title="{new_title}"', html)

        # 5. Sparkline bars  (replace all divs inside the flex container)
        new_bars = build_sparkline_bars(monthly_data)
        html = re.sub(
            r'(<div style="display:flex;align-items:flex-end[^>]*>)\s*'
            r'(?:<div title="[^"]*" style="background:#7C3AED[^/]*/>\s*)+',
            rf'\1\n        {new_bars}\n      ',
            html, flags=re.DOTALL
        )

        # 6. Spark label (e.g. "DRR Nov→Mar")
        first = MONTH_NAMES[monthly_data[0][1]]
        last  = MONTH_NAMES[monthly_data[-1][1]]
        html  = re.sub(r'DRR [A-Z][a-z]{2}→[A-Z][a-z]{2}', f'DRR {first}→{last}', html)

    with open(HTML_PATH, 'w', encoding='utf-8') as f:
        f.write(html)


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now().strftime('%Y-%m-%d %H:%M UTC')
    print(f'[{ts}] UniCapture data refresh starting...')

    active_count = get_active_count()
    print(f'  Active tenants : {active_count}')

    monthly_data = get_drr_monthly()
    if monthly_data:
        cur = monthly_data[-1][2]
        print(f'  Current DRR    : {cur:,}/day ({format_drr(cur)})')
        print(f'  Monthly trend  : {[(MONTH_NAMES[m], d) for _, m, d in monthly_data]}')
    else:
        print('  DRR data       : unavailable, keeping existing values')

    update_html(active_count, monthly_data)
    print(f'  {HTML_PATH} updated ✓')

    # Emit summary for GitHub Actions step summary
    summary = {
        'run_at'         : ts,
        'active_tenants' : active_count,
        'current_drr'    : monthly_data[-1][2] if monthly_data else None,
        'months_in_spark': len(monthly_data),
    }

    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        with open(summary_path, 'a') as f:
            f.write(f'## UniCapture Refresh — {ts}\n\n')
            f.write(f'| Metric | Value |\n|---|---|\n')
            f.write(f'| Active Tenants | **{active_count}** |\n')
            if monthly_data:
                f.write(f'| Current DRR | **{format_drr(monthly_data[-1][2])}/day** |\n')
            f.write(f'\n[View Dashboard](https://riteshdhakar94-sketch.github.io/Unicapture-upsell/UniCapture_Prospects_Preview.html)\n')

    print(f'\nSummary: {json.dumps(summary, indent=2)}')
    return summary


if __name__ == '__main__':
    main()
