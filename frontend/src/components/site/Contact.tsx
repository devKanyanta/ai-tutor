import { useState } from 'react';
import { ArrowRight, Mail, MessageCircle, Phone, Code } from 'lucide-react';
import { SiteHeader, SiteFooter } from './SiteChrome';
import { CONTACT, whatsappLink } from './contact';

const TOPICS = ['A question about Socratic', 'Feedback or an idea', 'Something is not working', 'Using it at my school or college'];

export const Contact: React.FC = () => {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');

  const text = [
    `Hi, ${name.trim() ? `I'm ${name.trim()}. ` : ''}I'm writing about Socratic: ${topic.toLowerCase()}.`,
    message.trim(),
  ].filter(Boolean).join('\n\n');

  const methods = [
    { icon: Mail, label: 'Email', value: CONTACT.email, href: `mailto:${CONTACT.email}` },
    { icon: Phone, label: 'Call', value: CONTACT.phoneDisplay, href: CONTACT.phoneHref },
    { icon: Code, label: 'GitHub', value: CONTACT.githubHandle, href: CONTACT.github },
  ];

  return (
    <div className="min-h-dvh bg-paper text-ink-900">
      <a href="#top" className="skip-link">Skip to content</a>
      <SiteHeader />

      <main id="top" className="px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="anim-fade-up mb-5 text-sm font-semibold text-board-600">Contact</p>
            <h1 className="anim-fade-up text-[2.4rem] font-semibold leading-[1.08] sm:text-5xl">Talk to a person.</h1>
            <p className="anim-fade-up mt-6 max-w-md text-lg leading-relaxed text-ink-600">
              Socratic is still being built. If something is unclear, broken, or could be better, tell us. The quickest way is WhatsApp.
            </p>
            <a
              href={whatsappLink("Hi, I'd like to ask about Socratic.")}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary anim-fade-up mt-8 !px-6 !py-3.5 text-base"
            >
              <MessageCircle className="h-5 w-5" /> Chat on WhatsApp
            </a>

            <ul className="mt-12 space-y-5">
              {methods.map(({ icon: Icon, label, value, href }) => (
                <li key={label}>
                  <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="group flex items-center gap-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-board-900 text-mark-300">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">{label}</span>
                      <span className="font-medium text-ink-900 group-hover:underline">{value}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <form
            className="card h-fit p-6 sm:p-8"
            onSubmit={(e) => {
              e.preventDefault();
              window.open(whatsappLink(text), '_blank', 'noopener');
            }}
          >
            <h2 className="text-xl">Write your message</h2>
            <p className="mt-1 text-sm text-ink-500">This opens WhatsApp with your message ready to send. Nothing is stored on this site.</p>

            <label className="mt-6 block text-sm font-medium text-ink-800" htmlFor="c-name">Your name <span className="font-normal text-ink-400">(optional)</span></label>
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1.5 w-full rounded-lg border border-ink-300 bg-white px-3.5 py-2.5 text-sm focus:border-board-500" />

            <label className="mt-5 block text-sm font-medium text-ink-800" htmlFor="c-topic">What is it about?</label>
            <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1.5 w-full rounded-lg border border-ink-300 bg-white px-3.5 py-2.5 text-sm focus:border-board-500">
              {TOPICS.map((t) => <option key={t}>{t}</option>)}
            </select>

            <label className="mt-5 block text-sm font-medium text-ink-800" htmlFor="c-message">Message</label>
            <textarea id="c-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} required className="mt-1.5 w-full resize-y rounded-lg border border-ink-300 bg-white px-3.5 py-2.5 text-sm focus:border-board-500" />

            <button type="submit" className="btn btn-primary mt-6 w-full !py-3">Send on WhatsApp <ArrowRight className="h-4 w-4" /></button>
            <p className="mt-3 text-center text-xs text-ink-500">Prefer email? <a className="underline" href={`mailto:${CONTACT.email}?subject=${encodeURIComponent('Socratic: ' + topic)}&body=${encodeURIComponent(message)}`}>Send it by email instead</a>.</p>
          </form>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
};
