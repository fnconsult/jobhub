/**
 * Skills shown as tags, one per skill: a Job Offer's, a CV's, the Match Score's covered and
 * missing ones, everywhere skills are read (editors keep their fields). A list, so a screen
 * reader counts them; `label` names it when nothing visible does.
 */
export function SkillTags({ skills, label, id }: { skills: readonly string[]; label?: string; id?: string }) {
  if (skills.length === 0) return null;
  return (
    <ul className="skill-list" aria-label={label} id={id}>
      {skills.map((skill, index) => (
        <li key={`${index}-${skill}`}>{skill}</li>
      ))}
    </ul>
  );
}
