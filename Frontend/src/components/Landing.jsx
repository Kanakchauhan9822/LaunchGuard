import { useEffect, useRef, useState } from 'react'
import { githubLoginUrl } from '../services/github'
import reviewJourney from '../assets/review-journey.jpg'
import inspection from '../assets/code-inspection.jpg'
import dashboardPreview from '../assets/workspace-dashboard.webp'
import findingsPreview from '../assets/workspace-findings.webp'
import codingPreview from '../assets/workspace-coding.webp'
import checksPreview from '../assets/workspace-checks.webp'
import historyPreview from '../assets/workspace-history.webp'
import './Landing.css'

export function Brand({ href = "#top", label = "LaunchGuard home", onClick }) {
  return <a href={href} onClick={onClick} aria-label={label}><span className="brand" aria-hidden="true" /></a>
}

const reviewSteps = [
  ['Connect GitHub', 'Sign in with GitHub and choose which repositories LaunchGuard can read. You can start with one repository and manage access later from your dashboard.'],
  ['Choose a project', 'Pick a repository from your connected account and save it as a project. Its reviews stay together, so you can return to an earlier report and see which commit it covered.'],
  ['Describe your project', 'Explain who uses the app, what they should be able to do, and what should happen when something goes wrong. For a private study room, mention who can join and what an uninvited user should see. Details like these guide your manual checks.'],
  ['Analyze the code', 'Run an entire-project review for a baseline. After a change, request a latest-changes review to inspect the edited files and the code they affect. The report records which checks finished and what they found.'],
  ['Explore your report', 'Start with the highest-severity finding. Open its affected files and lines, read the suggested fix, or copy a prompt for your coding agent. Then explore coding suggestions and run the manual checks yourself.']
]

const previews = [
  { name: 'Dashboard', image: dashboardPreview, detail: 'PeerSpace project dashboard with review actions, commit information and the findings panel.' },
  { name: 'Security findings', image: findingsPreview, detail: 'A high-severity finding alongside its affected file, line number and fix steps.' },
  { name: 'Coding suggestions', image: codingPreview, detail: 'A suggestion to share email validation across two forms, with its location and tradeoffs.' },
  { name: 'Manual checks', image: checksPreview, detail: 'A private-room access check with instructions and its expected result.' },
  { name: 'Review history', image: historyPreview, detail: 'A saved review with its date, scope, status and a link to open the report.' }
]

const headline = ['Know your code.', 'Ship with confidence.']

function TypedHeadline() {
  const ref = useRef(null)

  useEffect(() => {
    const title = ref.current
    const letters = [...title.querySelectorAll('[data-letter]')]
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let count = 0
    let timer
    letters.forEach(letter => letter.classList.add('untyped'))

    function typeNext() {
      letters[count - 1]?.classList.remove('typing-caret')
      const letter = letters[count++]
      letter.classList.remove('untyped')
      if (count < letters.length) {
        letter.classList.add('typing-caret')
        timer = window.setTimeout(typeNext, letter.textContent === '.' ? 240 : 48)
      }
    }

    typeNext()
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <h1 ref={ref} aria-label={headline.join(' ')}>
      {headline.map((line, index) => {
        const Style = index === 0 ? 'span' : 'em'
        return (
          <span className="headline-line" aria-hidden="true" key={line}>
            <Style>{Array.from(line, (letter, i) => <span data-letter="" key={i}>{letter}</span>)}</Style>
          </span>
        )
      })}
    </h1>
  )
}

export default function Landing({ loading, error, message }) {
  const [selected, setSelected] = useState(0)
  const preview = previews[selected]
  const landing = useRef(null)

  useEffect(() => {
    const root = landing.current
    const motion = window.matchMedia('(prefers-reduced-motion: no-preference)')
    let cleanup

    function syncMotion() {
      cleanup?.()
      if (!motion.matches) return

      const reveals = [...root.querySelectorAll('[data-reveal]')]
      const clamp = value => Math.max(0, Math.min(1, value))
      const track = root.querySelector('.preview-track')
      const stage = track.querySelector('.preview-stage')
      let pinTop = 0
      let ranges = []

      const guidance = root.querySelector('.guidance-story')
      const road = root.querySelector('#workflow')
      const list = road.querySelector('ol')
      const stops = [...list.children]
      let offsets = []
      let stride = 1
      let frame = 0

      function paint() {
        frame = 0
        for (const { node, start, end } of ranges) {
          const progress = clamp((window.scrollY - start) / (end - start))
          node.style.setProperty('--remaining', 1 - progress)
        }
        const travel = track.offsetHeight - stage.offsetHeight
        const progress = clamp((pinTop - track.getBoundingClientRect().top) / Math.max(1, travel))
        const open = clamp((Math.abs(2 * progress - 1) - .02) / .98)
        track.style.setProperty('--logo-opacity', clamp((.55 - open) / .3))
        track.style.setProperty('--preview-inset', (100 * (1 - open * open * (3 - 2 * open))) + '%')
        track.style.setProperty('--dashboard-visible', progress >= .5 ? 1 : 0)
        const distance = Math.max(0, Math.min(offsets.at(-1), -road.getBoundingClientRect().top))
        const fraction = (distance % stride) / stride
        const slide = clamp((fraction - .22) / .78)
        const eased = slide * slide * (3 - 2 * slide)
        const position = distance + (eased - fraction) * stride
        list.style.translate = -position + 'px 0'
        stops.forEach((stop, i) => {
          const length = offsets[i + 1] - offsets[i]
          const progress = length ? clamp((distance - offsets[i]) / (length * .72)) : 1
          stop.style.setProperty('--line-progress', progress)
          stop.style.setProperty('--stop-opacity', .55 + .45 * clamp(1 - Math.abs(position - offsets[i]) / stride))
        })
      }

      function measure() {
        pinTop = parseFloat(getComputedStyle(stage).top)
        offsets = stops.map(stop => stop.offsetLeft - stops[0].offsetLeft)
        stride = Math.max(1, offsets[1])
        road.style.setProperty('--travel', offsets.at(-1) + 'px')
        const height = window.innerHeight
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - height)
        const bounds = guidance.getBoundingClientRect()
        const sequenceStart = Math.max(0, bounds.top + window.scrollY - height * .8)
        const sequenceEnd = Math.min(maxScroll, bounds.bottom + window.scrollY - height * .2)
        const step = (sequenceEnd - sequenceStart) / 4
        ranges = reveals.map(node => {
          if (node.dataset.reveal === 'guidance') {
            const start = sequenceStart + Number(node.dataset.order) * step
            return { node, start, end: start + step }
          }
          let top = 0
          for (let parent = node; parent; parent = parent.offsetParent) top += parent.offsetTop
          const order = Number(node.dataset.order || 0)
          const sideEntry = node.dataset.reveal === 'left' || node.dataset.reveal === 'right'
          const span = sideEntry ? height * .75 : Math.min(150, height * .18)
          const end = Math.min(maxScroll, Math.max(span, top - height + span) + order * span * .75)
          return { node, start: Math.max(0, end - span), end }
        })
        schedule()
      }

      function schedule() {
        if (!frame) frame = requestAnimationFrame(paint)
      }

      root.classList.add('motion-ready')
      measure()
      const resize = new ResizeObserver(measure)
      resize.observe(root)
      window.addEventListener('resize', measure)
      resize.observe(list)
      stops.forEach(stop => resize.observe(stop))
      window.addEventListener('scroll', schedule, { passive: true })
      cleanup = () => {
        window.removeEventListener('resize', measure)
        resize.disconnect()
        window.removeEventListener('scroll', schedule)
        cancelAnimationFrame(frame)
        root.classList.remove('motion-ready')
        list.style.removeProperty('translate')
        cleanup = undefined
      }
    }

    syncMotion()
    motion.addEventListener('change', syncMotion)
    return () => {
      motion.removeEventListener('change', syncMotion)
      cleanup?.()
    }
  }, [])

  return (
    <main ref={landing} className="landing" id="top" onClick={event => {
      const anchor = event.target.closest('a[href^="#"]')
      const section = anchor && document.getElementById(anchor.hash.slice(1))
      if (section) {
        event.preventDefault()
        section.scrollIntoView()
      }
    }}>
      <header className="mast">
          <Brand />
          <nav aria-label="Main navigation">
            <a className="landing-nav-link" href="#product">Product</a>
            <a className="workflow-link landing-nav-link" href="#workflow">Workflow</a>
          </nav>
          <a className="nav-login" href={githubLoginUrl}>Sign in <span aria-hidden="true">↗</span></a>
      </header>
      <div className="launch-scene">
        <section className="hero">
          <div className="hero-copy">
            <TypedHeadline />
            <p>Review your GitHub project for security issues, get clear fixes, and see what to test before you launch.</p>
            <div className="hero-actions">
              <a className="primary" href={githubLoginUrl}>Connect GitHub <span aria-hidden="true">→</span></a>
              <a className="quiet-link" href="#product">Explore a review ↓</a>
            </div>
            {loading && <p role="status">Checking your connection…</p>}
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
          </div>
        </section>
        <div className="preview-track">
          <span id="product" aria-hidden="true" />
          <div className="preview-stage">
          <span className="brand preview-logo" aria-hidden="true" />
          <img className="hero-journey" src={reviewJourney} width="2172" height="724" fetchPriority="high" alt="A developer writes code on the left. It passes through the LaunchGuard review gate in the center before reaching a live website on the right." />
        <section className="dashboard-preview" aria-label="Explore the LaunchGuard dashboard">
          <div className="preview-toolbar">
            <span>Sample workspace</span>
            <div className="preview-options" role="group" aria-label="Dashboard views">
              {previews.map((item, index) => (
                <button className="motion-safe:transition-colors motion-safe:duration-200 active:brightness-125" type="button" key={item.name} aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.name}</button>
              ))}
            </div>
          </div>
          <figure aria-live="polite">
            <img key={preview.name} src={preview.image} width="1240" height="820" alt={preview.detail} />
            <figcaption>{preview.detail}</figcaption>
          </figure>
        </section>
          </div>
        </div>
      </div>
      <section className="story" id="workflow">
        <div className="road-stage">
        <h2>From GitHub to your review.</h2>
        <div className="road-window" tabIndex={0} role="region" aria-label="Five steps from GitHub to your review">
        <ol className="workflow-road" role="list">
          {reviewSteps.map(([title, description], index) => (
            <li key={title}>
              {index < reviewSteps.length - 1 && (
                <svg className="road-connector" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 30 C18 30 15 5 32 5 S57 55 72 55 S87 30 100 30" />
                </svg>
              )}
              <span className="road-marker" aria-hidden="true">{index + 1}</span>
              <div className="road-copy"><h3>{title}</h3><p>{description}</p></div>
            </li>
          ))}
        </ol>
        </div>
        </div>
      </section>
      <section className="story story-pair">
        <div data-reveal="left"><h2>See the issue.<br />Find the fix.</h2><p>Open a finding to see the affected files and lines. Expand its explanation for plain-English steps, or copy a fix prompt for your coding agent.</p>
          <a className="quiet-link" href="#product" onClick={() => setSelected(1)}>Explore a finding ↑</a>
        </div>
        <figure data-reveal="right" className="inspection-figure group"><img className="motion-safe:transition-transform motion-safe:duration-700 motion-safe:group-hover:scale-105" src={inspection} loading="lazy" alt="A magnifying lens examining a piece of code." /></figure>
      </section>
      <section className="story guidance-story">
        <div className="guidance-stage">
          <h2 data-reveal="guidance" data-order="0">Go beyond the findings.</h2>
          <div className="guidance-grid">
            <article data-reveal="guidance" data-order="1"><h3>Coding suggestions</h3><p>Review eligible source files for ways to simplify logic, improve naming and remove duplication. Each suggestion points back to the code.</p></article>
            <article data-reveal="guidance" data-order="2"><h3>Manual checks</h3><p>Get checks tailored to your project description and code. Expand a check for instructions, try it in your app, then mark it as checked.</p></article>
            <article data-reveal="guidance" data-order="3"><h3>Review history</h3><p>Reopen a saved report by commit. Use latest-changes reviews to follow which findings appeared, remained or were resolved.</p></article>
          </div>
        </div>
      </section>
      <section className="landing-close"><h2 data-reveal="up">Ready to review<br />your repository?</h2><a data-reveal="up" data-order="1" className="primary" href={githubLoginUrl}>Connect GitHub →</a></section>
      <footer className="landing-foot"><Brand /><a href="#top">Back to top ↑</a></footer>
    </main>
  )
}
