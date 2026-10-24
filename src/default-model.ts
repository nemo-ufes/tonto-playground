/** The first model in tonto's README, and the first one anyone here sees. */
export const DEFAULT_MODEL = `/// People and their employment.
ontology people

/// A person, in the everyday sense.
kind Person

/// A person employed by an organization.
role Employee specializes Person

/// An organization of people.
kind Organization

/// An organization that employs people.
role Employer specializes Organization

/// The employment binding an employee and an organization.
relator Employment {
    @mediation [1..*] -- [1] (const) Employee
    @mediation [1..*] -- [1] (const) Employer
}

@material relation Employee [1..*] -- worksFor -- [1..*] Employer derivedFrom Employment
`;
