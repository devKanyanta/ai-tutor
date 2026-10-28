import { useState } from 'react';
import { ArrowRight, Mic, BookOpenCheck, Presentation, ShieldCheck, FileUp, BarChart3, Plus, Minus } from 'lucide-react';
import { Link } from '../../router';
import { Logo } from '../Logo';
import { DemoLesson } from './DemoLesson';
import { useReveal } from './useReveal';

const FAQ = [
  ['Will it just give students the answers?', 'No. The tutor explains an idea in small steps, then asks the student to predict, explain or apply it before moving on. If a student says they are stuck, it teaches directly instead of quizzing them.'],
  ['Where do the answers come from?', 'Only from the documents you upload. Every explanation shows the file and section it was drawn from. If a question is outside your materials, the tutor says so and steers back to the course.'],
  ['What can I upload?', 'PDF, Word (.docx), plain text, Markdown and CSV files. Upload several at once, replace a file with a newer version, or delete it. Each document shows when it is ready for students.'],
  ['Do students need an account?', 'Not for the lesson itself. A student opens the page and starts. Chats are stored without personal details: email addresses, phone numbers and ID-style numbers are removed before saving.'],
  ['How does the voice lesson work?', 'The student presses start and talks. The tutor answers out loud, shows the explanation on the board as slides, and can be interrupted at any time. It needs a microphone and a secure (HTTPS) connection.'],
  ['What do instructors see?', 'The number of student sessions, how long conversations run, how often students were redirected back to the course, and thumbs up or down feedback on explanations.'],
];

const Section: React.FC<{ id?: string; className?: string; children: React.ReactNode }> = ({ id, className = '', children }) => (
  <section id={id} className={`scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28 ${className}`}>
    <div className="mx-auto max-w-6xl">{children}</div>
  </section>
);

export const Landing: React.FC = () => {
  useReveal();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="bg-paper text-ink-900">
      <a href="#top" className="skip-link">Skip to content</a>

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-8 text-sm font-medium text-ink-600 md:flex">
            <a href="#how" className="hover:text-ink-900">How it works</a>
            <a href="#educators" className="hover:text-ink-900">For instructors</a>
            <a href="#faq" className="hover:text-ink-900">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/studio" className="hidden px-3 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 sm:block">Instructor sign in</Link>
            <Link to="/learn" className="btn btn-primary !py-2 text-sm">Start learning</Link>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
            <div>
              <p className="anim-fade-up mb-5 text-sm font-semibold text-board-600">A study tutor for your own course</p>
              <h1 className="anim-fade-up text-[2.6rem] font-semibold leading-[1.05] text-ink-900 sm:text-6xl" style={{ animationDelay: '60ms' }}>
                Learn from your course, one idea at a time.
              </h1>
              <p className="anim-fade-up mt-6 max-w-lg text-lg leading-relaxed text-ink-600" style={{ animationDelay: '140ms' }}>
                Socratic teaches only from the materials your instructor uploads. Talk through a topic out loud, follow along on the board, and check your understanding before moving on.
              </p>
              <div className="anim-fade-up mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: '220ms' }}>
                <Link to="/learn" className="btn btn-primary !px-6 !py-3.5 text-base">Start a lesson <ArrowRight className="h-4 w-4" /></Link>
                <Link to="/studio" className="btn btn-ghost !px-6 !py-3.5 text-base">I’m an instructor</Link>
              </div>
              <p className="anim-fade-up mt-5 text-sm text-ink-500" style={{ animationDelay: '300ms' }}>No account needed. Works on phones, tablets and laptops.</p>
            </div>
            <div className="anim-fade-up" style={{ animationDelay: '200ms' }}><DemoLesson /></div>
          </div>
        </section>

        {/* Principles */}
        <section className="border-y border-ink-200 bg-surface px-5 py-16 sm:px-8">
          <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-3">
            {[
              [BookOpenCheck, 'Grounded in your materials', 'Answers come from the files you upload, with the source shown. Off-topic questions are politely steered back to the course.'],
              [Presentation, 'Teaches, then asks', 'Short explanations on a board, one idea per slide, followed by a question. Students think before they are told.'],
              [Mic, 'Speak or type', 'Hands-free voice lessons with a live transcript of what the student said, or plain typing when voice is not an option.'],
            ].map(([Icon, title, text], i) => {
              const I = Icon as typeof Mic;
              return (
                <div key={title as string} className="reveal" style={{ ['--d' as string]: `${i * 90}ms` }}>
                  <I className="mb-4 h-6 w-6 text-board-600" strokeWidth={1.75} />
                  <h3 className="text-xl text-ink-900">{title as string}</h3>
                  <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">{text as string}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <Section id="how">
          <div className="reveal max-w-2xl">
            <p className="mb-3 text-sm font-semibold text-board-600">How a lesson runs</p>
            <h2 className="text-4xl text-ink-900 sm:text-5xl">A short path from question to understanding.</h2>
          </div>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['01', 'Warm-up', 'The tutor opens with a real situation or a question to get you thinking, and outlines what you will cover.'],
              ['02', 'Learn', 'Key ideas arrive as slides, explained in plain language with examples drawn from your readings.'],
              ['03', 'Practice', 'You get one small problem or scenario to work through and receive specific feedback.'],
              ['04', 'Recap', 'A short summary locks in the main points and suggests what to study next.'],
            ].map(([n, t, d], i) => (
              <li key={n} className="reveal bg-surface p-7" style={{ ['--d' as string]: `${i * 80}ms` }}>
                <p className="font-serif text-3xl font-semibold text-board-400">{n}</p>
                <h3 className="mt-6 text-xl text-ink-900">{t}</h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">{d}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Educators */}
        <Section id="educators" className="bg-board-900 text-[#f1ece0] on-dark">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div className="reveal">
              <p className="mb-3 text-sm font-semibold text-mark-300">For instructors</p>
              <h2 className="text-4xl text-white sm:text-5xl">Your syllabus, your tutor.</h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-[#c9c3b3]">
                Upload your notes and readings, and students can start asking questions the same day. No prompts to write, nothing to configure.
              </p>
              <ul className="mt-8 space-y-5">
                {[
                  [FileUp, 'Upload and update', 'Drop in PDFs, Word files, Markdown, text or CSV. Replace a file when the material changes.'],
                  [ShieldCheck, 'Stays on topic', 'The tutor declines to go beyond your materials and resists attempts to change its role.'],
                  [BarChart3, 'See how it is used', 'Track sessions, conversation length, redirects and student feedback in one place.'],
                ].map(([Icon, t, d]) => {
                  const I = Icon as typeof FileUp;
                  return (
                    <li key={t as string} className="flex gap-4">
                      <I className="mt-0.5 h-5 w-5 shrink-0 text-mark-300" strokeWidth={1.75} />
                      <p className="text-[0.95rem] leading-relaxed text-[#c9c3b3]"><span className="font-semibold text-white">{t as string}. </span>{d as string}</p>
                    </li>
                  );
                })}
              </ul>
              <Link to="/studio" className="btn mt-10 bg-[#f6f2e9] !px-6 !py-3 text-board-900 hover:bg-white">Open the instructor studio <ArrowRight className="h-4 w-4" /></Link>
            </div>

            <div className="reveal rounded-xl border border-white/15 bg-board-950/60 p-5" style={{ ['--d' as string]: '120ms' }} role="img" aria-label="Example of the document library">
              <p className="mb-4 text-xs uppercase tracking-[0.14em] text-[#c9c3b3]">Example library</p>
              {[
                ['Syllabus.pdf', 'PDF', 'Ready'],
                ['Week 1 – Reading notes.docx', 'DOCX', 'Ready'],
                ['Week 2 – Lecture slides.pdf', 'PDF', 'Ready'],
                ['Glossary.csv', 'CSV', 'Indexing'],
              ].map(([name, type, status]) => (
                <div key={name} className="flex items-center gap-3 border-t border-white/10 py-3 first:border-t-0">
                  <span className="w-11 rounded bg-white/10 py-1 text-center text-[10px] font-semibold tracking-wider text-[#d8d2c2]">{type}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>
                  <span className={`text-xs font-medium ${status === 'Ready' ? 'text-board-300' : 'text-mark-300'}`}>{status}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* FAQ */}
        <Section id="faq">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
            <div className="reveal">
              <p className="mb-3 text-sm font-semibold text-board-600">Questions</p>
              <h2 className="text-4xl text-ink-900 sm:text-5xl">Good things to know.</h2>
            </div>
            <div className="reveal divide-y divide-ink-200 border-y border-ink-200">
              {FAQ.map(([q, a], i) => (
                <div key={q}>
                  <h3 className="!font-sans">
                    <button
                      onClick={() => setOpen(open === i ? null : i)}
                      aria-expanded={open === i}
                      aria-controls={`faq-${i}`}
                      className="flex w-full items-center justify-between gap-6 py-5 text-left text-base font-semibold text-ink-900 hover:text-board-600"
                    >
                      {q}
                      {open === i ? <Minus className="h-4 w-4 shrink-0" /> : <Plus className="h-4 w-4 shrink-0" />}
                    </button>
                  </h3>
                  <div id={`faq-${i}`} role="region" className={`grid transition-all duration-300 ease-out ${open === i ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden"><p className="pb-5 pr-8 leading-relaxed text-ink-600">{a}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* CTA */}
        <section className="px-5 pb-24 sm:px-8">
          <div className="reveal mx-auto max-w-6xl rounded-2xl bg-board-800 px-8 py-14 text-center on-dark sm:py-20">
            <h2 className="mx-auto max-w-2xl text-3xl text-white sm:text-5xl">Ready to learn it properly?</h2>
            <p className="mx-auto mt-4 max-w-lg text-[#c9c3b3]">Open a lesson and ask about anything in your course. It takes a few seconds to start.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/learn" className="btn bg-[#f6f2e9] !px-6 !py-3.5 text-base text-board-900 hover:bg-white">Start a lesson <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/studio" className="btn !px-6 !py-3.5 text-base text-[#f6f2e9] ring-1 ring-inset ring-white/30 hover:bg-white/10">Set up my course</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200 px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <Logo />
          <p className="max-w-md text-sm text-ink-500">Socratic answers only from the materials its instructor provides. It is a study aid and does not replace teaching.</p>
          <nav aria-label="Footer" className="flex gap-6 text-sm font-medium text-ink-600">
            <Link to="/learn" className="hover:text-ink-900">Learn</Link>
            <Link to="/studio" className="hover:text-ink-900">Instructors</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};
