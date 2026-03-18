/**
 * Excel writer — generates formatted .xlsx files from TSV data.
 * Uses exceljs to create professional-looking tables.
 */

import { execSync } from 'child_process'
import ExcelJS from 'exceljs'
import path from 'path'
import { getDataDir } from '../config'

/**
 * Create a formatted Excel file from TSV data string.
 * @param tsvData - Tab-separated data with header row
 * @param filename - Output filename (without extension)
 * @param filter - Optional: only include rows matching this substring
 * @returns Full path to the saved .xlsx file
 */
export async function createExcelFromTsv(
  tsvData: string,
  filename: string,
  filter?: string
): Promise<string> {
  const lines = tsvData.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) throw new Error('No data rows to write')

  // Skip summary lines (e.g. "Total: 12 negocios...")
  const dataLines = lines.filter((l) => l.includes('\t'))
  const headers = dataLines[0].split('\t')
  let rows = dataLines.slice(1).map((l) => l.split('\t'))

  // Apply filter if provided (e.g. "No" to get only those without website)
  if (filter) {
    rows = rows.filter((row) => row.some((cell) => cell.includes(filter)))
  }

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Datos')

  // Add header row
  sheet.addRow(headers)

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2B579A' }
  }
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' }
  headerRow.height = 25

  // Add data rows
  for (const row of rows) {
    sheet.addRow(row)
  }

  // Alternating row colors
  for (let i = 2; i <= rows.length + 1; i++) {
    const row = sheet.getRow(i)
    if (i % 2 === 0) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
      }
    }
    row.alignment = { vertical: 'middle' }
  }

  // Auto-fit column widths
  for (let colIdx = 1; colIdx <= headers.length; colIdx++) {
    const col = sheet.getColumn(colIdx)
    let maxLen = headers[colIdx - 1].length
    rows.forEach((row) => {
      const cellLen = (row[colIdx - 1] || '').length
      if (cellLen > maxLen) maxLen = cellLen
    })
    col.width = Math.min(maxLen + 4, 50)
  }

  // Add borders
  const lastRow = rows.length + 1
  const lastCol = headers.length
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = sheet.getCell(r, c)
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      }
    }
  }

  // Save to Desktop (Windows path via WSL)
  const desktopPath = getDesktopPath()
  const safeName = filename.replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ ]/g, '').trim() || 'datos'
  const filePath = path.join(desktopPath, `${safeName}.xlsx`)

  await workbook.xlsx.writeFile(filePath)

  // Auto-open: on WSL open with Windows Start, on native use shell
  try {
    const IS_WSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME
    if (IS_WSL) {
      const winPath = filePath.replace(/^\/mnt\/([a-z])\//, '$1:\\\\').replace(/\//g, '\\')
      execSync(`powershell.exe -NoProfile -NonInteractive -Command "Start-Process '${winPath}'"`, {
        timeout: 5000
      })
    } else {
      // In server mode, just log — no shell.openPath available
      console.log(`[excel] File saved: ${filePath}`)
    }
  } catch {
    // non-critical — file is saved either way
  }

  return filePath
}

function getDesktopPath(): string {
  const IS_WSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME
  if (IS_WSL) {
    const user = process.env.LOGNAME || process.env.USER || 'user'
    // Try Windows desktop via WSL
    try {
      const { execSync } = require('child_process')
      const winUser = execSync(
        'powershell.exe -NoProfile -NonInteractive -Command "[Environment]::UserName"',
        {
          encoding: 'utf-8',
          timeout: 3000
        }
      ).trim()
      return `/mnt/c/Users/${winUser}/Desktop`
    } catch {
      return path.join('/mnt/c/Users', user, 'Desktop')
    }
  }
  return path.join(getDataDir(), 'exports')
}
