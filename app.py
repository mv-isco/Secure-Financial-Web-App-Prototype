from flask import Flask, render_template, request, redirect, url_for, session, flash
import sqlite3
import secrets 
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = 'super_secret_key_change_this' 

# --- SECURITY CONFIGURATION ---
# 1. Session Timeout: Logs user out after 5 minutes of inactivity
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)
# 2. HttpOnly: JavaScript cannot read the cookie (Protects against XSS)
app.config['SESSION_COOKIE_HTTPONLY'] = True
# 3. SameSite: Cookie not sent on cross-site requests (Protects against CSRF)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

def get_db_connection():
    conn = sqlite3.connect('banking.db')
    conn.row_factory = sqlite3.Row
    return conn

# --- AUDIT LOGGING HELPER ---
def log_event(user_id, event_type, details):
    # Opens a FRESH connection to avoid deadlocks
    conn = sqlite3.connect('banking.db') 
    ip_address = request.remote_addr
    try:
        conn.execute('INSERT INTO audit_logs (user_id, event_type, ip_address, details) VALUES (?, ?, ?, ?)',
                     (user_id, event_type, ip_address, details))
        conn.commit()
    except Exception as e:
        print(f"Logging Failed: {e}")
    finally:
        conn.close()

@app.route('/')
def home():
    return redirect(url_for('login'))

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        email = request.form['email']
        password = request.form['password']
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')

        conn = get_db_connection()
        try:
            # Default role is 'user'
            conn.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                         (username, email, hashed_password, 'user'))
            conn.commit()
            flash('Registration successful! Please login.')
            return redirect(url_for('login'))
        except sqlite3.IntegrityError:
            flash('Username already exists!')
        finally:
            conn.close()

    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        
        if user:
            # CHECK 1: Is account locked?
            if user['locked_until']:
                locked_until = datetime.strptime(user['locked_until'], '%Y-%m-%d %H:%M:%S.%f')
                if datetime.now() < locked_until:
                    conn.close()
                    log_event(user['id'], 'LOGIN_LOCKED', f'Attempt on locked account: {username}')
                    flash(f'Account locked. Try again after {locked_until.strftime("%H:%M:%S")}')
                    return render_template('login.html')

            # CHECK 2: Password
            if check_password_hash(user['password_hash'], password):
                # SUCCESS: Reset failed attempts
                conn.execute('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', (user['id'],))
                conn.commit() # Commit to release lock
                conn.close()  # Close DB immediately
                
                # Setup Session
                session['user'] = user['username']
                session['user_id'] = user['id']
                session['role'] = user['role'] # <-- IMPORTANT: Store Role
                session.permanent = True 
                
                log_event(user['id'], 'LOGIN_SUCCESS', 'User logged in successfully')
                return redirect(url_for('dashboard'))
            else:
                # FAIL: Increment counter
                new_attempts = user['failed_attempts'] + 1
                if new_attempts >= 3:
                    lock_time = datetime.now() + timedelta(minutes=1) 
                    conn.execute('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', 
                                 (new_attempts, lock_time, user['id']))
                    conn.commit()
                    conn.close()
                    
                    log_event(user['id'], 'ACCOUNT_LOCKED', f'Account locked after {new_attempts} failures')
                    flash('Too many failed attempts! Account locked for 1 minute.')
                else:
                    conn.execute('UPDATE users SET failed_attempts = ? WHERE id = ?', 
                                 (new_attempts, user['id']))
                    conn.commit()
                    conn.close()
                    
                    log_event(user['id'], 'LOGIN_FAIL', 'Invalid password entered')
                    flash('Invalid credentials. Please try again.')
        else:
            conn.close()
            flash('Invalid credentials.') 
            log_event(None, 'LOGIN_FAIL_UNKNOWN', f'Failed login for user: {username}')
            
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    if 'user' not in session:
        return redirect(url_for('login'))
    return render_template('dashboard.html', user=session['user'])

@app.route('/transfer', methods=['GET', 'POST'])
def transfer():
    if 'user' not in session:
        return redirect(url_for('login'))

    # SECURITY CHECK: Admins cannot transfer money (Separation of Duties)
    if session.get('role') == 'admin':
        flash('Admins are restricted from financial transactions.')
        return redirect(url_for('dashboard'))

    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(16)

    if request.method == 'POST':
        # 1. CSRF CHECK
        token_from_form = request.form.get('csrf_token')
        token_from_session = session.get('csrf_token')
        
        if not token_from_form or token_from_form != token_from_session:
            log_event(session['user_id'], 'CSRF_ATTACK', 'CSRF Token Mismatch detected')
            return "Security Error: CSRF Token Mismatch", 403

        recipient = request.form['recipient']
        try:
            amount = float(request.form['amount'])
        except ValueError:
            flash('Invalid amount format.')
            return redirect(url_for('transfer'))

        if amount <= 0:
            flash('Amount must be positive.')
            return redirect(url_for('transfer'))

        conn = get_db_connection()
        user_id = session['user_id']
        
        # 2. CHECK BALANCE
        sender_acc = conn.execute('SELECT * FROM accounts WHERE user_id = ?', (user_id,)).fetchone()
        current_balance = sender_acc['balance'] if sender_acc else 1000.0 

        if current_balance < amount:
            conn.close()
            flash('Insufficient funds!')
            log_event(user_id, 'TRANSFER_FAIL', f'Insufficient funds. Tried sending {amount}')
        else:
            try:
                # 3. PERFORM TRANSFER
                new_balance = current_balance - amount
                
                # Update Sender
                if sender_acc:
                    conn.execute('UPDATE accounts SET balance = ? WHERE id = ?', (new_balance, sender_acc['id']))
                else:
                    import random
                    acc_num = str(random.randint(100000, 999999))
                    conn.execute('INSERT INTO accounts (user_id, account_number, balance) VALUES (?, ?, ?)', 
                                 (user_id, acc_num, new_balance))
                
                # Record Transaction
                conn.execute('INSERT INTO transactions (from_account, to_account, amount) VALUES (?, ?, ?)',
                             (session['user'], recipient, amount))
                
                conn.commit()
                conn.close() # Close DB before logging

                log_event(user_id, 'TRANSFER_SUCCESS', f'Sent ${amount} to {recipient}')
                flash(f'Successfully transferred ${amount} to {recipient}. New Balance: ${new_balance}')

            except Exception as e:
                if conn:
                    conn.rollback()
                    conn.close()
                flash('Transaction failed.')
                log_event(user_id, 'TRANSFER_ERROR', str(e))
        
        return redirect(url_for('dashboard'))

    return render_template('transfer.html', csrf_token=session['csrf_token'])

@app.route('/logout')
def logout():
    if 'user_id' in session:
        log_event(session['user_id'], 'LOGOUT', 'User logged out')
    session.clear()
    return redirect(url_for('login'))

# --- ADMIN LOGS ROUTE (PROTECTED) ---
@app.route('/admin/logs')
def view_logs():
    if 'user' not in session:
        return redirect(url_for('login'))
        
    # SECURITY: Role-Based Access Control (RBAC)
    if session.get('role') != 'admin':
        flash('ACCESS DENIED: Admins only.')
        return redirect(url_for('dashboard'))

    conn = get_db_connection()
    # SQL JOIN: Fetch logs AND the matching username
    logs = conn.execute('''
        SELECT audit_logs.*, users.username 
        FROM audit_logs 
        LEFT JOIN users ON audit_logs.user_id = users.id 
        ORDER BY audit_logs.timestamp DESC
    ''').fetchall()
    conn.close()
    return render_template('logs.html', logs=logs)

if __name__ == '__main__':
    app.run(debug=True)