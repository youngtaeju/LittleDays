// WHO 성장 기준 확장 표(z-score, 일 단위 L/M/S) xlsx → 월 단위(0~60개월) JSON.
// 일회성 변환. 결과 JSON 은 src/growth/who/ 에 커밋, xlsx 는 커밋 안 함.
//
// 사용:
//   node scripts/who-lms.mjs <lhfa-boys.xlsx> <lhfa-girls.xlsx> <wfa-boys.xlsx> <wfa-girls.xlsx> [출력 폴더]
// 입력: length/height-for-age, weight-for-age 페이지의 "Expanded tables" z-scores 파일.
// 출력 폴더 기본값 src/growth/who.
//
// 월 경계: m개월 = m * 30.4375일(WHO 확장 표 안내). 가장 가까운 날, 반올림.
// 키: 0~730일 누운 키(length), 731일부터 선 키(height). 24개월(730.5일)은 731일(선 키).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const DAYS_PER_MONTH = 30.4375
const MONTHS = 60
const LAST_LENGTH_DAY = 730

// zip 중앙 디렉터리에서 이름별 내용. 저장(0)과 deflate(8)만.
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('zip 끝 레코드 없음')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error('중앙 디렉터리 손상')
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    // 로컬 헤더의 이름/추가 필드 길이는 중앙 디렉터리와 다를 수 있음.
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    if (method === 0) files.set(name, raw)
    else if (method === 8) files.set(name, inflateRawSync(raw))
    else throw new Error(`지원 안 하는 압축 방식 ${String(method)}: ${name}`)
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function entry(files, name) {
  const b = files.get(name)
  if (!b) throw new Error(`xlsx 안에 ${name} 없음`)
  return b.toString('utf8')
}

// 첫 시트를 [{열 이름: 값}] 로. 첫 행이 머리글.
function readSheet(path) {
  const files = unzip(readFileSync(path))
  const sheetName =
    /<sheet [^>]*name="([^"]+)"/.exec(entry(files, 'xl/workbook.xml'))?.[1] ??
    ''
  const shared = [
    ...entry(files, 'xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs),
  ].map((m) =>
    [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
      .map((t) => decodeXml(t[1]))
      .join(''),
  )
  const rows = [
    ...entry(files, 'xl/worksheets/sheet1.xml').matchAll(
      /<row [^>]*>(.*?)<\/row>/gs,
    ),
  ].map((row) => {
    const cells = new Map()
    for (const c of row[1].matchAll(
      /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs,
    )) {
      const v = /<v>(.*?)<\/v>/s.exec(c[3] ?? '')?.[1]
      if (v === undefined) continue
      cells.set(c[1], /t="s"/.test(c[2]) ? shared[Number(v)] : v)
    }
    return cells
  })
  const [head, ...body] = rows
  if (!head) throw new Error(`${path}: 빈 시트`)
  const columns = [...head.entries()]
  const records = body.map((cells) =>
    Object.fromEntries(columns.map(([col, name]) => [name, cells.get(col)])),
  )
  return { sheetName, records }
}

function num(v, what) {
  const n = Number(v)
  if (v === undefined || !Number.isFinite(n))
    throw new Error(`숫자 아님: ${what}`)
  return n
}

// 일 단위 → 월 단위. 키 표는 24개월부터 731일 이후만.
function monthly(path, expect) {
  const { sheetName, records } = readSheet(path)
  const lower = sheetName.toLowerCase()
  const kindOk =
    expect.kind === 'weight' ? lower.startsWith('wfa') : /^l?h?fa/.test(lower)
  if (!kindOk || !lower.includes(`_${expect.sex}_`)) {
    throw new Error(
      `${path}: 시트 ${sheetName} 가 ${expect.kind}/${expect.sex} 표가 아님`,
    )
  }
  const byDay = new Map()
  for (const r of records) {
    const day = num(r.Day ?? r.Age, `${path} Day`)
    byDay.set(day, {
      L: num(r.L, `${path} L@${String(day)}`),
      M: num(r.M, `${path} M@${String(day)}`),
      S: num(r.S, `${path} S@${String(day)}`),
    })
  }
  const out = []
  for (let month = 0; month <= MONTHS; month++) {
    let day = Math.round(month * DAYS_PER_MONTH)
    if (expect.kind === 'height' && month >= 24)
      day = Math.max(day, LAST_LENGTH_DAY + 1)
    const lms = byDay.get(day)
    if (!lms) throw new Error(`${path}: ${String(day)}일 행 없음`)
    out.push({ month, ...lms })
  }
  return { sheetName, rows: records.length, out }
}

const [lhBoys, lhGirls, wBoys, wGirls, outArg] = process.argv.slice(2)
if (!lhBoys || !lhGirls || !wBoys || !wGirls) {
  console.error(
    'usage: node scripts/who-lms.mjs <lhfa-boys.xlsx> <lhfa-girls.xlsx> <wfa-boys.xlsx> <wfa-girls.xlsx> [outDir]',
  )
  process.exit(1)
}
const outDir = outArg
  ? resolve(outArg)
  : fileURLToPath(new URL('../src/growth/who/', import.meta.url))

const jobs = [
  [lhBoys, { kind: 'height', sex: 'boys' }, 'length-height-boys.json'],
  [lhGirls, { kind: 'height', sex: 'girls' }, 'length-height-girls.json'],
  [wBoys, { kind: 'weight', sex: 'boys' }, 'weight-boys.json'],
  [wGirls, { kind: 'weight', sex: 'girls' }, 'weight-girls.json'],
]
for (const [path, expect, name] of jobs) {
  const { sheetName, rows, out } = monthly(path, expect)
  writeFileSync(join(outDir, name), JSON.stringify(out, null, 2) + '\n')
  console.log(
    `${name}: ${sheetName}, ${String(rows)} days -> ${String(out.length)} months`,
  )
}
