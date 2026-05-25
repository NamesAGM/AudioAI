import os
import json
import uuid
import shutil
import sqlite3
import asyncio
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

# Import local services
from services.pdf_service import PDFService
from services.tts_service import TTSService

# Load configuration
load_dotenv()

app = FastAPI(title="AudioAI API", description="PDF to Audio conversion backend server")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create folders for local storage fallback
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
AUDIO_DIR = os.path.join(STATIC_DIR, "audio")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)

# Mount static directory to serve files locally
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Initialize Services
try:
    tts_service = TTSService()
    print("✓ TTS Service initialized")
except Exception as e:
    print(f"⚠ TTS Service initialization error: {e}")
    tts_service = None

try:
    pdf_service = PDFService()
    print("✓ PDF Service initialized")
except Exception as e:
    print(f"⚠ PDF Service initialization error: {e}")
    pdf_service = None

# Initialize Supabase client if keys are available
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Optional[Client] = None

if supabase_url and supabase_key:
    try:
        supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    except Exception as e:
        print(f"⚠ Supabase initialization error: {e}")

# Local Sandbox Database setup (if Supabase is not configured)
DB_PATH = os.path.join(os.path.dirname(__file__), "sandbox.db")
def init_sandbox_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversion_jobs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            status TEXT NOT NULL,
            pdf_url TEXT NOT NULL,
            audio_url TEXT,
            settings TEXT,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

if supabase_url and supabase_key:
    try:
        supabase = create_client(supabase_url, supabase_key)
        print("Connected to Supabase client successfully.")
    except Exception as e:
        print(f"Failed to connect to Supabase: {e}. Fallback to Local Sandbox database.")
        supabase = None
else:
    print("Supabase credentials missing. Running in Local Sandbox mode.")
    init_sandbox_db()

# DB Helpers that abstract database calls (Supabase vs SQLite)
def update_job_status(job_id: str, status: str, audio_url: Optional[str] = None, error_message: Optional[str] = None):
    if supabase:
        update_data = {"status": status, "updated_at": "now()"}
        if audio_url:
            update_data["audio_url"] = audio_url
        if error_message:
            update_data["error_message"] = error_message
        
        try:
            supabase.table("conversion_jobs").update(update_data).eq("id", job_id).execute()
        except Exception as e:
            print(f"Supabase update failed for job {job_id}: {e}")
    else:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        if audio_url and error_message:
            cursor.execute("UPDATE conversion_jobs SET status = ?, audio_url = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, audio_url, error_message, job_id))
        elif audio_url:
            cursor.execute("UPDATE conversion_jobs SET status = ?, audio_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, audio_url, job_id))
        elif error_message:
            cursor.execute("UPDATE conversion_jobs SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, error_message, job_id))
        else:
            cursor.execute("UPDATE conversion_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (status, job_id))
        conn.commit()
        conn.close()

def create_job_record(job_id: str, user_id: str, filename: str, pdf_url: str, settings: dict):
    if supabase:
        try:
            supabase.table("conversion_jobs").insert({
                "id": job_id,
                "user_id": user_id,
                "filename": filename,
                "status": "pending",
                "pdf_url": pdf_url,
                "settings": settings
            }).execute()
        except Exception as e:
            print(f"Supabase insert failed: {e}")
            raise HTTPException(status_code=500, detail="Database insertion failed")
    else:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO conversion_jobs (id, user_id, filename, status, pdf_url, settings) VALUES (?, ?, ?, ?, ?, ?)",
            (job_id, user_id, filename, "pending", pdf_url, json.dumps(settings))
        )
        conn.commit()
        conn.close()

async def process_conversion_task(job_id: str, local_pdf_path: str, filename: str, settings: dict):
    """
    Background worker that parses PDF, triggers TTS service, handles file uploads, and updates status.
    """
    update_job_status(job_id, "processing")
    
    local_audio_path = os.path.join(AUDIO_DIR, f"{job_id}.mp3")
    
    # Check if required services are available
    if not pdf_service or not tts_service:
        error_msg = "Required services not available. Check logs for initialization errors."
        print(f"Error in job {job_id}: {error_msg}")
        update_job_status(job_id, "failed", error_message=error_msg)
        return
    
    try:
        # Step 1: Extract and clean text from PDF
        raw_text = pdf_service.extract_text(local_pdf_path)
        cleaned_text = pdf_service.clean_text(raw_text)
        
        if not cleaned_text.strip():
            raise Exception("No readable text found in PDF. Make sure it is not a scanned/image-only PDF.")
            
        # Step 2: Split text into chunks
        chunks = pdf_service.chunk_text(cleaned_text, max_chars=4000)
        
        # Step 3: Run Text-To-Speech Synthesis
        success = await tts_service.synthesize_chunks(chunks, settings, local_audio_path)
        if not success:
            raise Exception("TTS Synthesis failed")
            
        # Step 4: Upload audio to storage / host locally
        audio_url = f"/static/audio/{job_id}.mp3"
        
        if supabase:
            # Upload PDF to Supabase Storage
            pdf_bucket = "pdfs"
            pdf_storage_name = f"{job_id}.pdf"
            with open(local_pdf_path, "rb") as f:
                supabase.storage.from_(pdf_bucket).upload(
                    pdf_storage_name, f, file_options={"content-type": "application/pdf"}
                )
            # Fetch public URL
            pdf_url = supabase.storage.from_(pdf_bucket).get_public_url(pdf_storage_name)
            
            # Upload Audio to Supabase Storage
            audio_bucket = "audio"
            audio_storage_name = f"{job_id}.mp3"
            with open(local_audio_path, "rb") as f:
                supabase.storage.from_(audio_bucket).upload(
                    audio_storage_name, f, file_options={"content-type": "audio/mpeg"}
                )
            # Fetch public URL
            audio_url = supabase.storage.from_(audio_bucket).get_public_url(audio_storage_name)
            
        update_job_status(job_id, "completed", audio_url=audio_url)
        
    except Exception as e:
        print(f"Error in job {job_id}: {e}")
        update_job_status(job_id, "failed", error_message=str(e))
    finally:
        # Keep local files in sandbox directory, or clean up if using production storage
        if supabase:
            if os.path.exists(local_pdf_path):
                os.remove(local_pdf_path)
            if os.path.exists(local_audio_path):
                os.remove(local_audio_path)

@app.get("/api/health")
def healthcheck():
    return {
        "status": "healthy",
        "google_tts_available": tts_service.google_available if tts_service else False,
        "supabase_connected": supabase is not None
    }

@app.get("/api/voices")
def get_voices():
    if not tts_service:
        return {"voices": [{"name": "edge-tts", "language": "en-US"}], "error": "Google TTS unavailable"}
    return tts_service.get_available_voices()

@app.post("/api/convert")
async def convert_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(...),
    voice_name: str = Form("en-US-Neural2-F"),
    language_code: str = Form("en-US"),
    speaking_rate: float = Form(1.0),
    gender: str = Form("FEMALE")
):
    # Validate file format
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    job_id = str(uuid.uuid4())
    
    # Save uploaded PDF to local disk temporarily
    local_pdf_path = os.path.join(UPLOAD_DIR, f"{job_id}.pdf")
    with open(local_pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    settings = {
        "voice_name": voice_name,
        "language_code": language_code,
        "speaking_rate": speaking_rate,
        "gender": gender
    }
    
    # Define PDF url for database insert
    pdf_url = f"/static/uploads/{job_id}.pdf"
    
    # Register job record in database
    create_job_record(job_id, user_id, file.filename, pdf_url, settings)
    
    # Trigger conversion process in the background
    background_tasks.add_task(
        process_conversion_task,
        job_id,
        local_pdf_path,
        file.filename,
        settings
    )
    
    return {
        "job_id": job_id,
        "status": "pending",
        "filename": file.filename
    }

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if supabase:
        try:
            res = supabase.table("conversion_jobs").select("*").eq("id", job_id).execute()
            if not res.data:
                raise HTTPException(status_code=404, detail="Job not found")
            return res.data[0]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
            
        job = dict(row)
        if job["settings"]:
            job["settings"] = json.loads(job["settings"])
        return job

@app.get("/api/users/{user_id}/jobs")
def get_user_jobs(user_id: str):
    if supabase:
        try:
            res = supabase.table("conversion_jobs").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
            return res.data
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversion_jobs WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        
        jobs = []
        for row in rows:
            job = dict(row)
            if job["settings"]:
                job["settings"] = json.loads(job["settings"])
            jobs.append(job)
        return jobs
