"""What a service is sold at, read the same way wherever the question is asked."""

import frappe


def customer_price(customer, service_item, on_date):
    """The selling price written for this customer and still in force on the day.

    Operations open a service on this number and Billing has to draw the invoice on the
    same one. Read without the customer, a generic price on the contract's list answers
    instead and the customer is billed at a rate nobody agreed; read without the dates, a
    price that expired last year answers for this month. Both are silent, and both are
    wrong by the difference, which is why the question is asked in one place only.
    """
    rows = frappe.db.sql(
        """
        select price.price_list_rate
        from `tabItem Price` price
        where price.item_code = %(item)s
          and price.customer = %(customer)s
          and price.selling = 1
          and ifnull(price.price_list_rate, 0) > 0
          and (price.valid_from is null or price.valid_from <= %(on_date)s)
          and (price.valid_upto is null or price.valid_upto >= %(on_date)s)
        order by price.valid_from desc
        limit 1
        """,
        {"customer": customer, "item": service_item, "on_date": on_date},
        pluck=True,
    )

    return frappe.utils.flt(rows[0]) if rows else None
