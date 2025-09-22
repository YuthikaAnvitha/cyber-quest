// static/app.js
let sessionId = null;
let questions = [];
let startTime = null;
let durationSeconds = null;
let countdownInterval = null;
let currentQuestionIndex = 0;
let answers = {};

function $(id){ return document.getElementById(id); }

function showStatus(msg, err=false){
  const s = $("status");
  s.textContent = msg;
  s.className = err ? "status error" : "status success";
}

// Enable/disable start button based on form validation
function updateStartButton() {
  const team = $("team").value.trim();
  const consent = $("consentCheck").checked;
  const startBtn = $("startBtn");
  
  if (team && consent) {
    startBtn.disabled = false;
  } else {
    startBtn.disabled = true;
  }
}

// Add event listeners for form validation
document.addEventListener('DOMContentLoaded', function() {
  $("team").addEventListener('input', updateStartButton);
  $("consentCheck").addEventListener('change', updateStartButton);
});

// Start button -> show Consent modal
$("startBtn").addEventListener('click', () => {
  const team = $("team").value.trim();
  if(!team){ showStatus("Please enter team or participant name.", true); return; }
  if(!$("consentCheck").checked){ showStatus("Please agree to the terms and conditions.", true); return; }
  
  $("confirmTeam").textContent = team;
  $("consentModal").classList.remove("hidden");
});

// Cancel ready
$("cancelReady").addEventListener('click', () => {
  $("consentModal").classList.add("hidden");
});

// Confirm ready -> call /start
$("confirmReady").addEventListener('click', async () => {
  const team = $("team").value.trim();
  $("confirmReady").disabled = true;
  showStatus("Starting quiz...");
  try {
    const resp = await fetch('/start', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({team})
    });
    const data = await resp.json();
    if(!resp.ok){ showStatus(data.error || "Could not start quiz", true); $("confirmReady").disabled=false; return; }

    sessionId = data.session_id;
    startTime = new Date(data.start_time);
    durationSeconds = data.duration_min * 60;
    questions = data.questions; // questions come without answers
    currentQuestionIndex = 0;
    answers = {};
    $("consentModal").classList.add("hidden");
    renderQuizUI(team);
    startCountdown();
  } catch(err) {
    showStatus("Network error starting quiz", true);
    $("confirmReady").disabled = false;
  }
});

// Render quiz UI with one question at a time
function renderQuizUI(team){
  const main = document.querySelector('.container');
  main.innerHTML = `
    <div class="quiz-container">
      <div class="quiz-header">
        <div class="quiz-info">
          <strong>Team: ${escapeHtml(team)}</strong>
          <span>Cyber Quest - Round 2</span>
        </div>
        <div class="timer" id="timer">--:--</div>
      </div>
      <div class="question-container">
        <div class="question-header">
          <div class="question-number" id="questionNumber">Question 1 of ${questions.length}</div>
          <div class="question-progress" id="questionProgress">1 / ${questions.length}</div>
        </div>
        <div id="questionContent"></div>
        <div class="quiz-actions">
          <div></div>
          <button id="nextBtn" class="next-button" disabled>
            <span>Next Question</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  `;

  renderCurrentQuestion();
  document.getElementById('nextBtn').addEventListener('click', nextQuestion);
}

// Render current question
function renderCurrentQuestion() {
  const question = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  
  // Update question number and progress
  $("questionNumber").textContent = `Question ${currentQuestionIndex + 1} of ${questions.length}`;
  $("questionProgress").textContent = `${currentQuestionIndex + 1} / ${questions.length}`;
  
  // Update next button
  const nextBtn = $("nextBtn");
  if (isLastQuestion) {
    nextBtn.innerHTML = '<span>Submit Quiz</span><span>✓</span>';
    nextBtn.className = 'submit-button';
    nextBtn.addEventListener('click', submitQuiz);
  } else {
    nextBtn.innerHTML = '<span>Next Question</span><span>→</span>';
    nextBtn.className = 'next-button';
    nextBtn.removeEventListener('click', submitQuiz);
  }
  
  // Render question content
  let techHtml = '';
  if(question.category === 'decode' && question.techniques){
    // Convert escaped newlines and tabs to proper HTML formatting
    let formattedTechniques = question.techniques
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
    
    // Split into sections and format each technique properly
    const sections = formattedTechniques.split('\n\n');
    let html = '';
    
    sections.forEach(section => {
      if (section.includes('Ciphering Techniques (reference)')) {
        html += `<h3 class="tech-title">${section}</h3>`;
      } else if (section.includes('Techniques you can use:')) {
        html += `<p class="tech-subtitle">${section}</p>`;
      } else if (section.includes('Caesar\'s cipher:')) {
        html += formatCipherTechnique(section, 'Caesar\'s Cipher');
      } else if (section.includes('Atbash Cipher')) {
        html += formatCipherTechnique(section, 'Atbash Cipher');
      } else if (section.includes('Transposition Cipher')) {
        html += formatCipherTechnique(section, 'Transposition Cipher');
      } else if (section.includes('Rail Fence Cipher')) {
        html += formatCipherTechnique(section, 'Rail Fence Cipher');
      }
    });
    
    techHtml = `<div class="tech-block">${html}</div>`;
  }
  
  // Helper function to format each cipher technique
  function formatCipherTechnique(section, title) {
    const lines = section.split('\n');
    let html = `<div class="cipher-method">
      <h4 class="cipher-name">${title}</h4>`;
    
    let inExample = false;
    let inGrid = false;
    let inZigzag = false;
    
    lines.forEach(line => {
      line = line.trim();
      if (!line) return;
      
      if (line.includes('Each letter is') || line.includes('To decode:')||line.includes('Arrange') ||line.includes('Letters are written') ) {
        html += `<p class="cipher-description">${line}</p>`;
      } else if (line.includes('Example with WELCOME:')) {
        html += `<p class="example-label">${line}</p>`;
        inExample = true;
        inGrid = false;
        inZigzag = false;
      } else if (line.includes('Grid (4 columns):')) {
        html += `<p class="example-label">${line}</p>`;
        inGrid = true;
        inExample = false;
        inZigzag = false;
      } else if (line.includes('Zig-zag:')) {
        html += `<p class="example-label">${line}</p>`;
        inZigzag = true;
        inExample = false;
        inGrid = false;
      } else if (inGrid && line.match(/^[WELCOMEX\s]+$/)) {
        // Format grid nicely
        const gridLine = line.replace(/\s+/g, ' ').trim();
        html += `<div class="cipher-grid">${gridLine}</div>`;
      } else if (inZigzag && line.match(/^[WELCOME\s]+$/)) {
        // Format zigzag nicely
        const zigzagLine = line.replace(/\s+/g, ' ').trim();
        html += `<div class="cipher-zigzag">${zigzagLine}</div>`;
      } else if (line.includes('Read column-wise:') || line.includes('Read rows:')) {
        html += `<p class="cipher-step">${line}</p>`;
      } else if (line.includes('Cipher:')) {
        html += `<p class="cipher-result"><strong>${line}</strong></p>`;
        inExample = false;
        inGrid = false;
        inZigzag = false;
      } else if (inExample && line.includes('→')) {
        html += `<p class="cipher-mapping">${line}</p>`;
      }
    });
    
    html += `</div>`;
    return html;
  }

  const optionsHtml = question.options.map((opt, i) => {
    const isSelected = answers[question.id] === i;
    return `<div class="option ${isSelected ? 'selected' : ''}">
      <input type="radio" name="q_${question.id}" value="${i}" id="opt_${question.id}_${i}" ${isSelected ? 'checked' : ''}>
      <label for="opt_${question.id}_${i}">${escapeHtml(opt)}</label>
    </div>`;
  }).join('');

  // Format question text properly
  const formattedQuestion = question.question
    .replace(/\\n/g, '\n')
    .replace(/\n/g, '<br>');
  
  $("questionContent").innerHTML = `
    <div class="question-text">${formattedQuestion}</div>
    ${techHtml}
    <div class="options">${optionsHtml}</div>
  `;

  // Add event listeners to options
  const optionInputs = document.querySelectorAll(`input[name="q_${question.id}"]`);
  optionInputs.forEach(input => {
    input.addEventListener('change', function() {
      // Update visual selection
      document.querySelectorAll(`input[name="q_${question.id}"]`).forEach(opt => {
        opt.closest('.option').classList.remove('selected');
      });
      this.closest('.option').classList.add('selected');
      
      // Store answer
      answers[question.id] = parseInt(this.value);
      
      // Enable next button
      $("nextBtn").disabled = false;
    });
  });

  // Check if already answered
  if (answers[question.id] !== undefined) {
    $("nextBtn").disabled = false;
  } else {
    $("nextBtn").disabled = true;
  }
}

// Move to next question
function nextQuestion() {
  if (currentQuestionIndex < questions.length - 1) {
    currentQuestionIndex++;
    renderCurrentQuestion();
  }
}

// Submit the entire quiz
async function submitQuiz() {
  $("nextBtn").disabled = true;
  $("nextBtn").textContent = "Submitting...";
  
  try {
    const resp = await fetch('/submit',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({session_id: sessionId, answers})
    });
    const data = await resp.json();
    if(!resp.ok){ 
      alert(data.error || "Submit failed"); 
      $("nextBtn").disabled = false;
      return; 
    }
    showResult(data);
  } catch(err){
    alert("Network error submitting");
    $("nextBtn").disabled = false;
  }
}

function startCountdown(){
  const endsAt = new Date(startTime.getTime() + durationSeconds*1000);
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
  
  function updateTimer(){
    const now = new Date();
    let rem = Math.floor((endsAt - now) / 1000);
    if(rem < 0) rem = 0;
    const mm = String(Math.floor(rem/60)).padStart(2,'0');
    const ss = String(rem%60).padStart(2,'0');
    
    const timerEl = $("timer");
    timerEl.textContent = `${mm}:${ss}`;
    
    // Add warning colors based on time remaining
    if (rem <= 300) { // 5 minutes
      timerEl.className = "timer danger";
    } else if (rem <= 600) { // 10 minutes
      timerEl.className = "timer warning";
    } else {
      timerEl.className = "timer";
    }
    
    if(rem === 0){
      clearInterval(countdownInterval);
      autoSubmit();
    }
  }
}

async function autoSubmit(){
  try {
    const resp = await fetch('/submit',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({session_id: sessionId, answers})
    });
    const data = await resp.json();
    showResult(data);
  } catch(err){
    showResult({
      attempted: Object.keys(answers).length,
      correct: 0,
      time_taken_seconds: durationSeconds,
      timed_out: true,
      error: "Network error during auto-submit"
    });
  }
}

function showResult(data){
  const main = document.querySelector('.container');
  const resultIcon = data.timed_out ? "⏰" : (data.correct >= data.attempted * 0.8 ? "🎉" : "📊");
  const resultTitle = data.timed_out ? "Time's Up!" : "Quiz Completed!";
  const resultSubtitle = data.timed_out ? "Your answers have been auto-submitted" : "Thank you for participating";
  
  main.innerHTML = `
    <div class="result-container">
      <div class="result-header">
        <div class="result-icon">${resultIcon}</div>
        <h2 class="result-title">${resultTitle}</h2>
        <p class="result-subtitle">${resultSubtitle}</p>
      </div>
      
      <div class="result-stats">
        <div class="stat-item">
          <span class="stat-value">${data.attempted || 0}</span>
          <span class="stat-label">Questions Attempted</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${data.correct || 0}</span>
          <span class="stat-label">Correct Answers</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${Math.floor((data.time_taken_seconds || 0) / 60)}:${String((data.time_taken_seconds || 0) % 60).padStart(2, '0')}</span>
          <span class="stat-label">Time Taken</span>
        </div>
      </div>
      
      <div class="wait-message">
        <strong>Please wait for the results to be announced.</strong><br>
        Your submission has been recorded successfully.
      </div>
    </div>
  `;
  
  if(countdownInterval) clearInterval(countdownInterval);
}

function escapeHtml(s){
  if(!s) return s;
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}
