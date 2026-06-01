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
    # Allow all origins via regex during troubleshooting; replace with specific origins for production
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create folders for local storage fallback
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
AUDIO_DIR = os.path.join(STATIC_DIR, "audio")

try:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(AUDIO_DIR, exist_ok=True)
    print(f"[OK] Storage directories created/verified")
    print(f"  - Upload dir: {UPLOAD_DIR}")
    print(f"  - Audio dir: {AUDIO_DIR}")
except Exception as e:
    print(f"[ERROR] Error creating storage directories: {e}")

# Mount static directory to serve files locally
try:
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    print("[OK] Static files mounted")
except Exception as e:
    print(f"[ERROR] Error mounting static files: {e}")

# Initialize Services
try:
    tts_service = TTSService()
    print("[OK] TTS Service initialized")
except Exception as e:
    print(f"[ERROR] TTS Service initialization error: {e}")
    tts_service = None

try:
    pdf_service = PDFService()
    print("[OK] PDF Service initialized")
except Exception as e:
    print(f"[ERROR] PDF Service initialization error: {e}")
    pdf_service = None

# Initialize Supabase client if keys are available
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Optional[Client] = None

if supabase_url and supabase_key:
    try:
        supabase = create_client(supabase_url, supabase_key)
        print("[OK] Supabase client initialized")
    except Exception as e:
        print(f"[ERROR] Supabase initialization error: {e}")

# Local Sandbox Database setup (if Supabase is not configured)
DB_PATH = os.path.join(os.path.dirname(__file__), "sandbox.db")

def init_sandbox_db():
    try:
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
        print("[OK] Sandbox database initialized")
    except Exception as e:
        print(f"[ERROR] Sandbox database initialization error: {e}")

# Always initialize sandbox DB as fallback
init_sandbox_db()

# Try to initialize Supabase
if supabase_url and supabase_key:
    try:
        supabase = create_client(supabase_url, supabase_key)
        print("[OK] Supabase client connected")
    except Exception as e:
        print(f"[ERROR] Supabase connection failed: {e}. Using sandbox database.")
        supabase = None
else:
    print("[INFO] Supabase credentials not set. Using sandbox database.")
    supabase = None

# DB Helpers that abstract database calls (Supabase vs SQLite)
def _update_job_status_sqlite(job_id: str, status: str, audio_url: Optional[str] = None, error_message: Optional[str] = None):
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


def update_job_status(job_id: str, status: str, audio_url: Optional[str] = None, error_message: Optional[str] = None):
    global supabase
    if supabase:
        update_data = {"status": status, "updated_at": "now()"}
        if audio_url:
            update_data["audio_url"] = audio_url
        if error_message:
            update_data["error_message"] = error_message

        try:
            response = supabase.table("conversion_jobs").update(update_data).eq("id", job_id).execute()
            if hasattr(response, "error") and response.error:
                raise Exception(response.error)
            return
        except Exception as e:
            print(f"Supabase update failed for job {job_id}: {e}. Falling back to SQLite.")
            supabase = None

    _update_job_status_sqlite(job_id, status, audio_url, error_message)


def is_supabase_user_valid(user_id: str) -> bool:
    if not supabase:
        return False

    try:
        response = supabase.table("profiles").select("id").eq("id", user_id).limit(1).execute()
        if hasattr(response, "error") and response.error:
            print(f"[ERROR] Supabase profile query failed for user {user_id}: {response.error}")
            return False

        data = getattr(response, "data", None)
        if data is None:
            print(f"[ERROR] Unexpected Supabase profile response format for user {user_id}: {response}")
            return False

        return bool(data)
    except Exception as e:
        print(f"[ERROR] Supabase profile validation failed for user {user_id}: {e}")
        return False


def _insert_job_record_sqlite(job_id: str, user_id: str, filename: str, pdf_url: str, settings: dict, status: str = "pending"):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR IGNORE INTO conversion_jobs (id, user_id, filename, status, pdf_url, settings) VALUES (?, ?, ?, ?, ?, ?)",
        (job_id, user_id, filename, status, pdf_url, json.dumps(settings))
    )
    conn.commit()
    conn.close()


def create_job_record(job_id: str, user_id: str, filename: str, pdf_url: str, settings: dict):
    global supabase
    try:
        created_in_supabase = False
        if supabase:
            try:
                if is_supabase_user_valid(user_id):
                    response = supabase.table("conversion_jobs").insert({
                        "id": job_id,
                        "user_id": user_id,
                        "filename": filename,
                        "status": "pending",
                        "pdf_url": pdf_url,
                        "settings": settings
                    }).execute()

                    if hasattr(response, "error") and response.error:
                        raise Exception(response.error)

                    print(f"[OK] Job {job_id} created in Supabase")
                    created_in_supabase = True
                else:
                    print(f"[WARN] Supabase user {user_id} not found in profiles. Using SQLite fallback.")
            except Exception as e:
                print(f"[ERROR] Supabase job insert failed for user {user_id}: {e}. Falling back to SQLite.")
                supabase = None

        _insert_job_record_sqlite(job_id, user_id, filename, pdf_url, settings)
        print(f"[OK] Job {job_id} created in SQLite")

        if created_in_supabase:
            print(f"[OK] Local mirror created for job {job_id}.")

    except Exception as e:
        print(f"Error creating job record: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to create job record: {str(e)}")

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
        chunks = pdf_service.chunk_text(cleaned_text, max_chars=1200)
        
        # Step 3: Run Text-To-Speech Synthesis
        success = await tts_service.synthesize_chunks(chunks, settings, local_audio_path)
        if not success:
            raise Exception("TTS Synthesis failed")
            
        # Step 4: Upload files to Supabase Storage (persistent) or keep locally (ephemeral)
        audio_url = f"/static/audio/{job_id}.mp3"
        pdf_url_final = f"/static/uploads/{job_id}.pdf"
        
        if supabase:
            try:
                # Upload PDF to Supabase Storage
                pdf_bucket = "pdfs"
                pdf_storage_name = f"{job_id}.pdf"
                print(f"[STORAGE] Uploading PDF to Supabase bucket '{pdf_bucket}'...")
                with open(local_pdf_path, "rb") as f:
                    supabase.storage.from_(pdf_bucket).upload(
                        pdf_storage_name, f, file_options={"content-type": "application/pdf"}
                    )
                pdf_url_final = supabase.storage.from_(pdf_bucket).get_public_url(pdf_storage_name)
                print(f"[STORAGE] PDF uploaded: {pdf_url_final}")
                
                # Upload Audio to Supabase Storage
                audio_bucket = "audio"
                audio_storage_name = f"{job_id}.mp3"
                print(f"[STORAGE] Uploading audio to Supabase bucket '{audio_bucket}'...")
                with open(local_audio_path, "rb") as f:
                    supabase.storage.from_(audio_bucket).upload(
                        audio_storage_name, f, file_options={"content-type": "audio/mpeg"}
                    )
                audio_url = supabase.storage.from_(audio_bucket).get_public_url(audio_storage_name)
                print(f"[STORAGE] Audio uploaded: {audio_url}")
                
            except Exception as storage_err:
                print(f"[STORAGE ERROR] Failed to upload to Supabase Storage: {storage_err}")
                print("[STORAGE] Falling back to local file storage. Files will NOT persist across deploys.")
                audio_url = f"/static/audio/{job_id}.mp3"
                pdf_url_final = f"/static/uploads/{job_id}.pdf"
            
        update_job_status(job_id, "completed", audio_url=audio_url)
        
        # Also update the pdf_url in the database to point to Supabase Storage
        if supabase and pdf_url_final.startswith("http"):
            try:
                supabase.table("conversion_jobs").update({"pdf_url": pdf_url_final}).eq("id", job_id).execute()
            except Exception:
                pass  # Non-critical, pdf_url is mainly for preview
        else:
            # Update SQLite with local pdf_url
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.execute("UPDATE conversion_jobs SET pdf_url = ? WHERE id = ?", (pdf_url_final, job_id))
                conn.commit()
                conn.close()
            except Exception:
                pass
        
    except Exception as e:
        print(f"Error in job {job_id}: {e}")
        update_job_status(job_id, "failed", error_message=str(e))
    finally:
        # Clean up local temp files after uploading to Supabase
        if supabase:
            if os.path.exists(local_pdf_path):
                os.remove(local_pdf_path)
            if os.path.exists(local_audio_path):
                os.remove(local_audio_path)

# Startup event to verify everything is initialized
@app.on_event("startup")
async def startup_event():
    print("\n" + "="*60)
    print("[STARTUP] AudioAI Backend Starting Up...")
    print("="*60)
    print(f"[SERVICES] Services:")
    print(f"  - PDF Service: {'[OK]' if pdf_service else '[FAIL]'}")
    print(f"  - TTS Service: {'[OK]' if tts_service else '[FAIL]'}")
    if tts_service:
        print(f"    - Google TTS: {'[OK]' if tts_service.google_available else '[FAIL]'}")
    print(f"[DATABASE] Database:")
    print(f"  - Supabase: {'[OK]' if supabase else '[FAIL]'}")
    print(f"  - Sandbox DB: {DB_PATH}")
    print(f"[STORAGE] Storage:")
    print(f"  - Uploads: {UPLOAD_DIR} ({'[OK]' if os.path.exists(UPLOAD_DIR) else '[FAIL]'})")
    print(f"  - Audio: {AUDIO_DIR} ({'[OK]' if os.path.exists(AUDIO_DIR) else '[FAIL]'})")
    print("="*60 + "\n")

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
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in convert_pdf: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Conversion failed: {str(e)}")

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    global supabase
    try:
        if supabase:
            try:
                res = supabase.table("conversion_jobs").select("*").eq("id", job_id).execute()
                if hasattr(res, "error") and res.error:
                    raise Exception(res.error)
                if not res.data:
                    raise HTTPException(status_code=404, detail="Job not found")
                return res.data[0]
            except Exception as e:
                print(f"Supabase read failed for job {job_id}: {e}. Falling back to SQLite.")
                supabase = None

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversion_jobs WHERE id = ?", (job_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
            
        job = dict(row)
        if job.get("settings"):
            try:
                job["settings"] = json.loads(job["settings"])
            except:
                pass
        return job
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error fetching job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/users/{user_id}/jobs")
def get_user_jobs(user_id: str):
    global supabase
    try:
        if supabase:
            try:
                res = supabase.table("conversion_jobs").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
                if hasattr(res, "error") and res.error:
                    raise Exception(res.error)
                return res.data
            except Exception as e:
                print(f"Supabase read failed for user {user_id}: {e}. Falling back to SQLite.")
                supabase = None

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversion_jobs WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        
        jobs = []
        for row in rows:
            job = dict(row)
            if job.get("settings"):
                try:
                    job["settings"] = json.loads(job["settings"])
                except:
                    pass
            jobs.append(job)
        return jobs
    except Exception as e:
        print(f"Error fetching jobs for user {user_id}: {e}")
        return []
