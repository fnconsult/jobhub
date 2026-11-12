"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface LandingStoryStep {
  id: string;
  /** « Étape 2 sur 4 ». */
  label: string;
  title: string;
  text: string;
  /** The product's screen for this step. */
  screen: ReactNode;
}

/**
 * The method as a story read by scrolling (ADR-0105): on a wide screen the steps scroll on one side while the product's
 * screen stays in view on the other and changes with the step being read, a mark under it saying how far the story is.
 * On a phone and a tablet nothing sticks: each step is followed by its own screen. Only one copy of a screen is ever
 * drawn (the stylesheet hides the other), and of the screens that stay in view only the one being read, so each picture
 * is read out once. Before the page is interactive, and wherever the step being read cannot be told, the first step's
 * screen is shown.
 */
export function LandingStory({ steps }: { steps: readonly LandingStoryStep[] }) {
  const [reading, setReading] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // The step that crosses the middle of the window is the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = items.current.indexOf(entry.target as HTMLLIElement);
          if (index >= 0) setReading(index);
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    for (const item of items.current) if (item) observer.observe(item);
    return () => observer.disconnect();
  }, [steps.length]);

  return (
    <div className="landing-story">
      <ol className="landing-story__steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            ref={(element) => {
              items.current[index] = element;
            }}
            className="landing-story__step"
            data-reading={index === reading ? "" : undefined}
          >
            <span className="landing-story__label">{step.label}</span>
            <h3 className="landing-h3">{step.title}</h3>
            <p className="landing-body">{step.text}</p>
            <div className="landing-story__inline">{step.screen}</div>
          </li>
        ))}
      </ol>
      <div className="landing-story__sticky">
        <div>
          <div className="landing-story__views">
            {steps.map((step, index) => (
              <div key={step.id} className="landing-story__view" data-reading={index === reading ? "" : undefined}>
                {step.screen}
              </div>
            ))}
          </div>
          <div className="landing-story__progress">
            {steps.map((step, index) => (
              <i key={step.id} data-read={index <= reading ? "" : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
