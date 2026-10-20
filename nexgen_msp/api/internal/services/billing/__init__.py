"""The Billing module's read and write surface, one shape per screen.

Everything the Billing screens need is served from here: the workspace behind the
landing page, the two detail views, and the single operation the wizard performs. The
engine that computes coverage and talks to ERPNext stays in `billing_service`; these
modules only decide what a screen is told and what a decision is allowed to do.
"""
