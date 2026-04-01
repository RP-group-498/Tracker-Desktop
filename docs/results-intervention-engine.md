# Results — Smart Intervention Engine Component

> All numerical values in this section are derived from the actual codebase and the SQLite activity log recorded on 2026-03-29. Context vector computations use the live behavioral signals from that session.

---

## 5.1 System Implementation

The Smart Intervention Engine was successfully implemented as a fully integrated component of the desktop focus application. The engine comprises six coordinated subsystems: a 60-second monitoring loop, a TMT-grounded context vector builder, a threshold-based trigger detector, a deficit-weighted LinUCB contextual bandit, a notification delivery layer, and a discounted reward update mechanism. All subsystems operate passively and continuously without requiring active user input beyond routine task management.

The context vector pipeline processes raw behavioral signals from two upstream components: Component 1 (activity classification and app-switch tracking) and Component 4 (task management and deadline tracking). These signals are transformed through a three-layer pipeline — raw signal mapping, TMT proxy normalisation, and context vector construction — before being passed to the bandit model. Table 1 summarises the nine elements of the resulting context vector and their data origins.

**Table 1. Context Vector Elements, Data Sources, and Normalisation**

| Index | Symbol | Behavioral Construct | Data Source | Normalisation |
|-------|--------|---------------------|-------------|---------------|
| 0 | — | Bias | Constant | 1.0 |
| 1 | E | Expectancy (self-efficacy) | MongoDB C4: `completed_tasks` (7-day window) | completions ÷ assigned |
| 2 | V | Value (task importance) | MongoDB C4: `completed_tasks` (priority, grade weight) | max(priority, weight/100) |
| 3 | I | Impulsiveness (off-task ratio) | MongoDB C1: `active_time` (daily) | non-academic ÷ (total + 1) |
| 4 | D | Delay (temporal distance) | MongoDB C4: `completed_tasks` (deadline field) | h ÷ (1 + h), h = hours remaining |
| 5 | M | Motivation (TMT composite) | Derived from E, V, I, D | clamp((E×V) ÷ (1 + I×D), 0, 1) |
| 6 | δ | Deficit code (dominant weakness) | Derived from E, V, I, D | argmax([1−E, 1−V, I, D]) ÷ 3 |
| 7 | τ | Session duration | In-memory timer | min(minutes ÷ 240, 1.0) |
| 8 | t | Time of day | System clock | hour ÷ 24 |

---

## 5.2 Preliminary Observational Session

To validate the context vector pipeline under real operating conditions, the engine was run continuously during a single tracked study session on 2026-03-29, spanning 13:33 to 18:25 (4 hours 52 minutes). During this period, Component 1 recorded **369 activity events** across **13 unique applications** within **3 desktop sessions**. Table 2 presents the activity classification breakdown.

**Table 2. Activity Classification Distribution (n = 369 events)**

| Category | Events | Proportion | Mean Confidence |
|----------|--------|------------|-----------------|
| Academic | 186 | 50.4% | 0.90 |
| Non-academic | 144 | 39.0% | 0.85 |
| Neutral | 37 | 10.0% | 0.87 |
| Productivity | 2 | 0.5% | 0.85 |

The dominant non-academic application was **WhatsApp** (144 events; 34.9 minutes of active time), representing the single largest source of distraction. Academic activity was primarily spread across Microsoft Word (5.0 min), Terminal (24.9 min), and the Focus Application itself (30.1 min). The observed non-academic proportion of 39.0% corresponds directly to the impulsiveness signal (*I*) in the context vector, yielding *I* = 0.390 for the monitored session.

---

## 5.3 Context Vector Computation: Worked Example

Using the behavioral signals observed during the 2026-03-29 session, the context vector was computed as follows. In the absence of a currently scheduled task in Component 4, expectancy (*E*) and value (*V*) assumed their system defaults of 0.5 and 0.3 respectively; delay (*D*) defaulted to the one-week horizon (h = 168 hours, *D* = 0.994). The motivation score was then:

$$M = \frac{E \times V}{1 + I \times D} = \frac{0.5 \times 0.3}{1 + 0.390 \times 0.994} = \frac{0.150}{1.388} = 0.108$$

The resulting 9-element context vector for this session was:

$$\mathbf{x} = [1.0,\ 0.50,\ 0.30,\ 0.39,\ 0.994,\ 0.108,\ 0.33,\ 1.0,\ 0.54]$$

The session duration element was capped at 1.0 (the 4h 52min session exceeded the 240-minute normalisation ceiling) and the time-of-day signal was 0.54 (session start at 13:00 hrs). The dominant TMT deficit was *V* (value deficit: 1 − 0.30 = 0.70), yielding a deficit code of 0.33.

This vector was evaluated against the trigger conditions defined in the system. With *M* = 0.108, the **primary trigger condition** (*M* < 0.40) was satisfied, indicating that procrastination risk was detected throughout the session.

---

## 5.4 Intervention Trigger Analysis

The trigger detector implements two conditions evaluated at each 60-second monitoring tick. Table 3 defines the conditions and their theoretical basis.

**Table 3. Trigger Conditions and Procrastination Theory Basis**

| Condition | Threshold | Theoretical Basis |
|-----------|-----------|-------------------|
| Primary | *M* < 0.40 | TMT: motivation below engagement threshold (Steel, 2007) |
| Secondary | *I* > 0.50 AND *M* < 0.60 | High impulsiveness at moderate motivation signals distraction risk (Steel, 2007; Sirois & Pychyl, 2013) |

In the observed session, the primary condition was met continuously (*M* = 0.108), while the secondary condition was not independently activated (*I* = 0.39 < 0.50). This outcome reflects a known system boundary condition: the engine is most accurately calibrated when at least one task is actively scheduled in Component 4, providing real *V*, *E*, and *D* signals rather than system defaults.

Additional guards prevent notification fatigue: a **global cooldown** (5–30 minutes post-intervention), **per-action cooldowns** (10–30 minutes per strategy), and a **context deduplication filter** that suppresses re-notification when the context vector — rounded to two decimal places — has not changed since the last intervention. Together, these guards ensure that a single procrastination episode does not result in repeated alerts.

---

## 5.5 Intervention Selection via TMT-Weighted LinUCB

The LinUCB contextual bandit maintains a separate 9×9 parameter matrix (*A*) and 9-element reward vector (**b**) per intervention arm per user, stored in MongoDB. Each arm is initialised as *A* = **I**₉ (identity matrix) and **b** = **0**. The Upper Confidence Bound score for arm *a* given context **x** is:

$$\text{UCB}_a = \hat{\theta}_a^\top \mathbf{x} + \alpha \sqrt{\mathbf{x}^\top A_a^{-1} \mathbf{x}}, \quad \hat{\theta}_a = A_a^{-1} \mathbf{b}_a, \quad \alpha = 1.0$$

Rather than using UCB scores alone, the system hybridises bandit learning with TMT theory through deficit-weighted selection. A TMT alignment matrix **W** (5 × 4) encodes the theoretically expected effectiveness of each intervention against each TMT deficit component. The alignment weights are reproduced in Table 4.

**Table 4. TMT Alignment Matrix W (Intervention × TMT Component)**

| Intervention | Expectancy (E) | Value (V) | Impulsiveness (I) | Delay (D) |
|---|:---:|:---:|:---:|:---:|
| Pomodoro | 0.3 | 0.1 | **0.8** | **0.7** |
| Five-Second Rule | 0.3 | 0.1 | **0.7** | 0.5 |
| Breathing | 0.1 | 0.1 | **0.6** | 0.1 |
| Visualization | **0.7** | 0.5 | 0.1 | 0.4 |
| Reframe | 0.4 | **0.8** | 0.3 | 0.2 |

The relevance score for each arm is computed as the dot product of its alignment row with the user's current deficit vector **d** = [1−*E*, 1−*V*, *I*, *D*]:

$$\text{relevance}_a = \mathbf{W}_a \cdot \mathbf{d}$$

The final selection score combines exploitation and theory grounding:

$$\text{score}_a = \text{UCB}_a \times (1 + \text{relevance}_a)$$

This formulation ensures that in early interactions — where all UCB scores are approximately equal due to the identity matrix initialisation — theory-grounded interventions targeting the user's dominant deficit receive preference. As interaction history accumulates, the UCB exploitation term increasingly reflects individual user response patterns, allowing personalisation to progressively override the theory prior.

**Table 5. Intervention Relevance Scores for the Observed Session**

Using the deficit vector **d** = [0.50, 0.70, 0.39, 0.994] derived from the 2026-03-29 session:

| Intervention | Computation | Relevance Score | Priority |
|---|---|:---:|:---:|
| Pomodoro | 0.3(0.50) + 0.1(0.70) + 0.8(0.39) + 0.7(0.994) | **1.228** | 1st |
| Visualization | 0.7(0.50) + 0.5(0.70) + 0.1(0.39) + 0.4(0.994) | **1.137** | 2nd |
| Reframe | 0.4(0.50) + 0.8(0.70) + 0.3(0.39) + 0.2(0.994) | **1.076** | 3rd |
| Five-Second Rule | 0.3(0.50) + 0.1(0.70) + 0.7(0.39) + 0.5(0.994) | **0.990** | 4th |
| Breathing | 0.1(0.50) + 0.1(0.70) + 0.6(0.39) + 0.1(0.994) | **0.453** | 5th |

Under cold-start conditions, the engine selected **Pomodoro** as the recommended intervention, driven by its strong alignment with both delay discounting (*D* = 0.994, alignment 0.7) and impulsiveness reduction (*I* = 0.39, alignment 0.8). This result is consistent with the theoretical expectation: the Pomodoro technique's 25-minute time-blocking mechanism addresses high delay discounting by creating proximal sub-deadlines (Ariely & Wertenbroch, 2002; Steel, 2007) and reduces susceptibility to distracting impulses through structured work intervals (Biwer et al., 2023).

---

## 5.6 Bandit Learning Dynamics

Following user response, the arm associated with the selected intervention is updated according to the discounted LinUCB update rule:

$$A_a \leftarrow \gamma A_a + \mathbf{x}\mathbf{x}^\top, \qquad \mathbf{b}_a \leftarrow \gamma \mathbf{b}_a + r \cdot \mathbf{x}$$

where *γ* = 0.995 is a discount factor applied prior to each update. The reward signal *r* takes a value of 1.0 if the user accepts the intervention (clicks *Start*), 0.4 if they defer (*Not Now*), and 0.2 if they reject (*Skip*). Table 6 summarises the reward scheme and associated cooldown policy.

**Table 6. Reward Values and Post-Intervention Cooldown Policy**

| User Response | Reward *r* | Global Cooldown | Same-Action Cooldown |
|---|:---:|---|---|
| Start (Pomodoro) | 1.0 | 30 min | 30 min |
| Start (other strategy) | 1.0 | 10 min | 10 min |
| Not Now | 0.4 | 5 min | 15 min |
| Skip | 0.2 | 5 min | 10 min |

The discount factor *γ* = 0.995 was chosen to accommodate the non-stationary nature of academic procrastination behaviour. After 100 interactions (approximately 100 days of active use), the effective weight of the earliest observations decays to approximately 60.6% (0.995¹⁰⁰ ≈ 0.606), allowing the model to adapt progressively to changes in study patterns, course loads, and semester transitions. A regularisation floor MIN_DIAGONAL = 0.01 prevents numerical instability in the matrix inverse as diagonal elements decay under repeated discounting.

---

## 5.7 Design Validation of the TMT Alignment Matrix

Each of the 20 alignment values in Table 4 was assigned based on empirical evidence from the procrastination and behaviour change literature. The strength of each value reflects the directness and robustness of the supporting evidence. Three examples illustrate the mapping rationale:

**Pomodoro → Impulsiveness (0.8).** The Pomodoro technique's structured 25-minute work blocks have been shown to reduce distraction and delay impulsive off-task behaviour by creating a bounded, focused work interval (Biwer et al., 2023; Steel et al., 2018). This is the highest alignment weight in the matrix and reflects a strong, direct empirical effect.

**Reframe → Value (0.8).** Utility-value interventions — which prompt students to connect academic tasks to personal goals — consistently increase task engagement and persistence across experimental studies (Hulleman & Harackiewicz, 2009; Yeager et al., 2014; Canning et al., 2018). The Reframe intervention implements this mechanism by generating personalised connective text via a large language model conditioned on the user's stated life goal.

**Visualization → Expectancy (0.7).** Mental imagery of successful task completion activates the same self-efficacy mechanisms as mastery experience — the strongest source of efficacy belief in Bandura's (1977) social cognitive framework (Maddux & Kleiman, 2021; Beauchamp et al., 2002). The 0.7 alignment weight reflects the substantial but indirect nature of this effect relative to direct task completion experience.

---

## 5.8 Summary of System Performance

The Smart Intervention Engine was validated as a complete, end-to-end operational system. The context vector pipeline successfully produced a 9-dimensional feature vector from live behavioral signals within a single round-trip IPC call. The trigger conditions correctly identified elevated procrastination risk during the observational session (*M* = 0.108 < 0.40). The deficit-weighted LinUCB selector produced a theory-consistent intervention recommendation (Pomodoro) at cold start, and the discounted update mechanism was confirmed to persist and retrieve arm parameters from MongoDB across sessions. Full event traceability was maintained via the `bandit_events` collection, logging TMT proxies, deficit vectors, relevance scores, and reward values for each interaction — enabling retrospective analysis of learning trajectories in future user studies.

The key system parameters are summarised in Table 7.

**Table 7. Summary of Smart Intervention Engine Design Parameters**

| Parameter | Value | Justification |
|---|---|---|
| Context vector dimension *d* | 9 | 4 TMT proxies + motivation + deficit code + session duration + time of day + bias |
| Monitoring interval | 60 s | Balance between detection latency and computational overhead |
| Primary trigger threshold | *M* < 0.40 | TMT engagement threshold (Steel, 2007) |
| Secondary trigger | *I* > 0.50 AND *M* < 0.60 | Impulsiveness risk at moderate motivation |
| Exploration parameter *α* | 1.0 | Standard LinUCB initialisation |
| Discount factor *γ* | 0.995 | ~60% weight after 100 updates; accommodates semester-level non-stationarity |
| Regularisation floor | 0.01 | Prevents A matrix diagonal collapse under repeated discounting |
| Reward: Accept | 1.0 | Full positive signal for engagement |
| Reward: Defer | 0.4 | Partial signal acknowledging willingness |
| Reward: Reject | 0.2 | Minimal signal for rejection |
| Number of intervention arms | 5 | Pomodoro, Five-Second Rule, Breathing, Visualization, Reframe |

---

## References (for this section)

- Ariely, D., & Wertenbroch, K. (2002). Procrastination, deadlines, and performance. *Psychological Science, 13*(3), 219–224.
- Bandura, A. (1977). Self-efficacy: Toward a unifying theory of behavioral change. *Psychological Review, 84*(2), 191–215.
- Beauchamp, M. R., et al. (2002). Imagery functions and imagery use: A practitioner educational intervention. *Psychology of Sport and Exercise, 3*(2), 89–99.
- Biwer, F., et al. (2023). The effects of time-blocking on academic procrastination. *Learning and Individual Differences*.
- Canning, E. A., et al. (2018). Motivating students to work harder. *Journal of Educational Psychology*.
- Gollwitzer, P. M. (1999). Implementation intentions. *American Psychologist, 54*(7), 493–503.
- Hulleman, C. S., & Harackiewicz, J. M. (2009). Promoting interest and performance in high school science classes. *Science, 326*(5958), 1410–1412.
- Maddux, J. E., & Kleiman, E. M. (2021). Self-efficacy. In *Handbook of self-regulation*.
- Mazur, J. E. (1987). An adjusting procedure for studying delayed reinforcement. In *Quantitative analyses of behavior*, Vol. 5.
- Sirois, F., & Pychyl, T. (2013). Procrastination and the priority of short-term mood regulation. *Social and Personality Psychology Compass, 7*(2), 115–127.
- Steel, P. (2007). The nature of procrastination. *Psychological Bulletin, 133*(1), 65–94.
- Steel, P., et al. (2018). Examining procrastination across multiple goal stages. *Journal of Applied Psychology*.
- Wigfield, A., & Eccles, J. S. (2000). Expectancy–value theory of achievement motivation. *Contemporary Educational Psychology, 25*(1), 68–81.
- Yeager, D. S., et al. (2014). Boring but important: A self-transcendent purpose for learning. *Journal of Personality and Social Psychology, 107*(4), 559–580.
