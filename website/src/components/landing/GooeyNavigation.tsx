import { useEffect, useRef, useState } from 'react';
import GooeyNav from '../effects/GooeyNav';

const items = [
  { label: 'Demo', href: '#workflow' },
  { label: 'Features', href: '#features' },
  { label: 'AI', href: '#tools' },
  { label: 'Install', href: '#install' },
  { label: 'Docs', href: '/docs/' },
];

export default function GooeyNavigation() {
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedUntil = useRef(0);

  useEffect(() => {
    const sections = items.map(item => item.href.startsWith('#') ? document.querySelector(item.href) : null);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (performance.now() < selectedUntil.current) return;
      let current = 0;
      sections.forEach((section, index) => {
        if (section && section.getBoundingClientRect().top <= Math.max(100, innerHeight * 0.3)) current = index;
      });
      setActiveIndex(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return <GooeyNav
    items={items}
    activeIndex={activeIndex}
    onChange={index => {
      selectedUntil.current = performance.now() + 900;
      setActiveIndex(index);
    }}
    frame={false}
    size="sm"
    color="#242424"
    activeTextColor="#ffffff"
    colors={['#242424', '#2b2b2b', '#333333']}
    animationTime={650}
    timeVariance={120}
    particleCount={12}
    spread={20}
    gooeyness={0.6}
    wobble={0.35}
    className="site-gooey-nav"
  />;
}
