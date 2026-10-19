import Typewriter from '../effects/Typewriter';

const sequences = [
  { text: 'Git repositories.', deleteAfter: true, pauseAfter: 1500 },
  { text: 'code reviews.', deleteAfter: true, pauseAfter: 1300 },
  { text: 'pull requests.', deleteAfter: true, pauseAfter: 1300 },
  { text: 'next commit.', deleteAfter: true, pauseAfter: 1300 },
];

export default function HeroTypewriter() {
  return <span className="hero-typewriter-group">
    <span aria-hidden="true">
      <Typewriter
        sequences={sequences}
        as="span"
        className="hero-typewriter"
        textClassName="hero-typewriter-text"
        typingSpeed={42}
        deleteSpeed={22}
        startDelay={400}
        loopDelay={220}
        naturalVariance
        announce={false}
      />
    </span>
    <span className="sr-only">Git repositories.</span>
  </span>;
}
