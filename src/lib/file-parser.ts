export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith(".txt")) {
    return file.text()
  }

  if (name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse") as unknown as {
      PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> }
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    return result.text
  }

  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    const mammoth = await import("mammoth")
    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  throw new Error("不支持的文件格式，请上传 PDF、Word 或 TXT 文件")
}
