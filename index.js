require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const xlsx = require('xlsx');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

// Setup Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Setup File Upload
const upload = multer({ storage: multer.memoryStorage() });

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ DB Error:", err));

// Basic Route to check if server is live
app.get('/', (req, res) => res.send("Tally Converter API is Live and Ready for PDF & Excel!"));

// --- THE CORE CONVERTER ROUTE ---
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload a file." });

    let extractedText = "";
    const fileName = req.file.originalname.toLowerCase();

    // 1. Read the File (PDF or EXCEL)
    if (fileName.endsWith('.pdf')) {
      const data = await pdf(req.file.buffer);
      extractedText = data.text;
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
      
      // Convert Excel rows to plain text for the AI
      extractedText = sheetData.map(row => row.join(" ")).join("\n");
    } else {
      return res.status(400).json({ error: "Unsupported file format. Please upload PDF or Excel." });
    }

    // 2. Send the extracted text to Gemini AI
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 
    const prompt = `You are an expert accountant. Convert the following bank statement data into a Tally Prime importable XML format. 
    Rules: 
    - Use "Bank Account" as the Bank Ledger Name.
    - Use "Suspense Account" as the Party Ledger Name.
    - Output ONLY the raw XML code. Do not include markdown formatting or explanations.
    
    Data: \n\n${extractedText.substring(0, 30000)}`;

    const result = await model.generateContent(prompt);
    let aiResponse = result.response.text();

    // 3. Clean the response so it is pure XML
    let finalXml = aiResponse.replace(/```xml/g, '').replace(/```/g, '').trim();

    // 4. Send XML back to the website
    res.json({ success: true, xml: finalXml });

  } catch (error) {
    console.error("Conversion Error:", error);
    res.status(500).json({ error: "Failed to process the file." });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
