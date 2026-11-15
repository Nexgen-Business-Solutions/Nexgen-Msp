"""What a service is sold at, read the same way wherever the question is asked."""

import frappe


def customer_price(customer, service_item, on_date, price_list=None, currency=None):
    """The selling price written for this customer and still in force on the day.

    Operations open a service on this number and Billing has to draw the invoice on the
    same one. Read without the customer, a generic price on the contract's list answers
    instead and the customer is billed at a rate nobody agreed; read without the dates, a
    price that expired last year answers for this month. Both are silent, and both are
    wrong by the difference, which is why the question is asked in one place only.

    A company billed in two currencies can hold two valid prices for one service, and they
    are not alternatives: one of them is simply not the money this contract is drawn in.
    So the contract's own price list and currency narrow the question when they are known,
    and when after that more than one price still answers, nothing is returned at all.
    Guessing between two prices is how an invoice goes out at a number nobody agreed, and
    the caller reports a missing rate, which somebody can see and settle.
    """
    conditions = ""
    values = {"customer": customer, "item": service_item, "on_date": on_date}

    if price_list:
        conditions += " and price.price_list = %(price_list)s"
        values["price_list"] = price_list

    if currency:
        conditions += " and price.currency = %(currency)s"
        values["currency"] = currency

    rows = frappe.db.sql(
        f"""
        select price.price_list_rate, price.currency, price.price_list
        from `tabItem Price` price
        where price.item_code = %(item)s
          and price.customer = %(customer)s
          and price.selling = 1
          and ifnull(price.price_list_rate, 0) > 0
          and (price.valid_from is null or price.valid_from <= %(on_date)s)
          and (price.valid_upto is null or price.valid_upto >= %(on_date)s)
          {conditions}
        order by price.valid_from desc
        """,
        values,
        as_dict=True,
    )

    if not rows:
        return None

    # one price, or several that agree: the same number said more than once is not an
    # ambiguity. Several that disagree is, and it is not ours to settle
    distinct = {frappe.utils.flt(row.price_list_rate) for row in rows}

    if len(distinct) > 1:
        return None

    return frappe.utils.flt(rows[0].price_list_rate)
